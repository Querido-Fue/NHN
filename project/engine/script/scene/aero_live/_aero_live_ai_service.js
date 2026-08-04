import { getData } from 'data/data_handler.js';
import { AeroLiveLlmContract } from './_aero_live_llm_contract.mjs';

const AI_CONSTANTS = getData('AERO_LIVE_SCENE_CONSTANTS').AI;
const MAX_RESPONSE_BYTES = 256 * 1024;
const ACCEPTED_FINISH_REASONS = new Set(['STOP', 'FINISH_REASON_UNSPECIFIED', '']);

/**
 * AERO LIVE의 일반 채팅 생성과 플레이어 입력 분류를 Gemini REST API에 연결합니다.
 * 일반 채팅 실패는 빈 배치로 폴백하고, 플레이어 입력 판정 실패는 전송을 보류합니다.
 */
export class AeroLiveAiService {
    /**
     * @param {{rules?:object, fetchImpl?:Function}} [options={}] - 테스트 또는 런타임 주입 옵션입니다.
     */
    constructor(options = {}) {
        this.rules = options.rules || AI_CONSTANTS;
        this.fetchImpl = options.fetchImpl || null;
        this.contract = new AeroLiveLlmContract(this.rules);
        this.controllers = new Set();
        this.chatCache = new Map();
        this.generation = 0;
        this.requestSequence = 0;
        this.requestQueue = [];
        this.activeJob = null;
        this.maxQueuedRequests = Math.max(
            1,
            Number(this.rules.MAX_REQUEST_QUEUE_SIZE) || 32
        );
        this.destroyed = false;
        this.idleStatus = this.rules.ENABLED === false ? '로컬 모드' : 'AI 준비';
        this.status = this.idleStatus;
        this.hasReportedKeyError = false;
    }

    /**
     * 현재 AI 연결 상태를 짧은 UI 문자열로 반환합니다.
     * @returns {string} 상태 문자열입니다.
     */
    getStatus() {
        this.#refreshStatus();
        return this.status;
    }

    /**
     * 장면 맥락에 맞는 일반 채팅을 배치로 생성합니다.
     * @param {object} context - beat-started 이벤트 맥락입니다.
     * @returns {Promise<{chats:Array,source:string}>} 생성 결과입니다.
     */
    async generateChatBatch(context) {
        if (this.destroyed) {
            return this.#buildDiscardedChatResult();
        }
        if (this.rules.ENABLED === false) {
            return { chats: [], source: 'local-only' };
        }

        const viewerIds = this.#resolveViewerIds(context);
        const modelId = this.#resolveModelId('chat');
        const cacheKey = this.#buildCacheKey('chat', {
            topic: context?.topic,
            heroText: context?.heroText,
            mood: context?.mood,
            opinion: context?.opinion,
            viewerIds,
            chatSlots: Array.isArray(context?.fallbackChats)
                ? context.fallbackChats.slice(0, Number(this.rules.CHAT_BATCH_SIZE) || 3).map((chat) => ({
                    viewerId: chat?.viewerId || chat?.viewer_id || chat?.nickname || '',
                    sentiment: chat?.sentiment || 'neutral'
                }))
                : []
        }, modelId);
        const cached = this.chatCache.get(cacheKey);
        if (cached) {
            this.#touchCacheEntry(cacheKey, cached);
            this.#setIdleStatus('AI 캐시');
            return { chats: cached.map((chat) => ({ ...chat })), source: 'cache' };
        }

        return this.#enqueueRequest({
            lane: 'chat',
            modelId,
            execute: (job) => this.#executeChatRequest(job, context, viewerIds, cacheKey),
            discardedResult: () => this.#buildDiscardedChatResult(),
            overflowResult: () => ({ chats: [], source: 'fallback', overflow: true })
        });
    }

    /**
     * 플레이어 위장 채팅을 기획서의 다섯 의도 중 하나로 분류합니다.
     * @param {object} context - 메시지와 현재 방송 맥락입니다.
     * @returns {Promise<{intent:string,confidence:number,reason:string,hero_reply:string,hero_expression:string,callback_text:string,reaction_chats:Array,source:string}>} 분류 결과입니다.
     */
    async classifyPlayerMessage(context) {
        if (this.destroyed) {
            return this.#buildDiscardedIntentResult();
        }
        const localResult = this.contract.classifyLocally(context?.message || '');
        if (localResult.intent === 'blocked') {
            this.#setIdleStatus('안전 필터 차단');
            return { ...localResult, reaction_chats: [], source: 'local-safety' };
        }
        if (this.rules.ENABLED === false) {
            this.#setIdleStatus('의도 판정 보류');
            return {
                ...this.#buildTechnicalFailureResult('AI 판정을 시작할 수 없어 메시지를 전송하지 않았습니다.'),
                source: 'technical-failure'
            };
        }

        const viewerIds = this.#resolveViewerIds(context);
        const modelId = this.#resolveModelId('intent');
        return this.#enqueueRequest({
            lane: 'intent',
            modelId,
            execute: (job) => this.#executeIntentRequest(job, context, viewerIds),
            discardedResult: () => this.#buildDiscardedIntentResult(),
            overflowResult: () => ({
                ...this.#buildTechnicalFailureResult(
                    'AI 요청이 많아 판정을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'
                ),
                source: 'technical-failure',
                overflow: true
            })
        });
    }

    /**
     * 진행 중인 모든 Gemini 요청을 취소하고 늦게 도착한 결과를 무효화합니다.
     */
    abortAll() {
        this.generation += 1;
        if (this.activeJob) {
            this.#settleJob(this.activeJob, this.activeJob.discardedResult());
        }
        const queuedJobs = this.requestQueue.splice(0);
        for (const job of queuedJobs) {
            this.#settleJob(job, job.discardedResult());
        }
        for (const controller of this.controllers) {
            controller.abort();
        }
        this.controllers.clear();
        if (!this.destroyed) {
            this.idleStatus = 'AI 요청 취소됨';
        }
        this.#refreshStatus();
    }

    /**
     * 서비스 수명주기를 종료합니다.
     */
    destroy() {
        this.destroyed = true;
        this.abortAll();
        this.chatCache.clear();
        this.idleStatus = '종료됨';
        this.status = '종료됨';
    }

    /**
     * 공급자 요청을 chat/intent 구분 없이 하나의 FIFO 대기열에 넣습니다.
     * @param {object} definition - lane별 실행 함수와 안전 결과 factory입니다.
     * @returns {Promise<object>} 해당 요청에 연결된 결과 Promise입니다.
     * @private
     */
    #enqueueRequest(definition) {
        if (this.destroyed) {
            return Promise.resolve(definition.discardedResult());
        }
        if (this.requestQueue.length >= this.maxQueuedRequests) {
            this.#setIdleStatus('AI 대기열 포화');
            return Promise.resolve(definition.overflowResult());
        }

        const job = {
            id: ++this.requestSequence,
            generation: this.generation,
            lane: definition.lane,
            modelId: definition.modelId,
            execute: definition.execute,
            discardedResult: definition.discardedResult,
            overflowResult: definition.overflowResult,
            resolve: null,
            settled: false
        };
        const resultPromise = new Promise((resolve) => {
            job.resolve = resolve;
        });
        this.requestQueue.push(job);
        this.#refreshStatus();
        this.#pumpQueue();
        return resultPromise;
    }

    /**
     * 활성 작업이 없을 때 가장 오래 기다린 유효 요청 하나만 실행합니다.
     * @private
     */
    #pumpQueue() {
        if (this.destroyed || this.activeJob) {
            return;
        }

        let job = this.requestQueue.shift() || null;
        while (job && (job.settled || job.generation !== this.generation)) {
            this.#settleJob(job, job.discardedResult());
            job = this.requestQueue.shift() || null;
        }
        if (!job) {
            this.#refreshStatus();
            return;
        }

        this.activeJob = job;
        this.#refreshStatus();
        void this.#runJob(job);
    }

    /**
     * 단일 작업을 실행하고 완료된 뒤에만 다음 작업으로 넘어갑니다.
     * @param {object} job - 현재 활성 요청입니다.
     * @private
     */
    async #runJob(job) {
        try {
            const result = this.#isJobCurrent(job)
                ? await job.execute(job)
                : job.discardedResult();
            this.#settleJob(
                job,
                this.#isJobCurrent(job) ? result : job.discardedResult()
            );
        } catch (error) {
            if (!this.#isJobCurrent(job)) {
                this.#settleJob(job, job.discardedResult());
            } else if (job.lane === 'chat') {
                this.#setIdleStatus('로컬 폴백');
                this.#reportSafeWarning('일반 채팅 생성', error);
                this.#settleJob(job, { chats: [], source: 'fallback' });
            } else {
                this.#setIdleStatus('의도 판정 실패');
                this.#reportSafeWarning('자유 채팅 분류', error);
                this.#settleJob(job, {
                    ...this.#buildTechnicalFailureResult(
                        'AI 판정을 완료하지 못해 메시지를 전송하지 않았습니다.'
                    ),
                    source: 'technical-failure'
                });
            }
        } finally {
            if (this.activeJob === job) {
                this.activeJob = null;
            }
            this.#refreshStatus();
            this.#pumpQueue();
        }
    }

    /**
     * 일반 채팅 공급자 요청 하나를 실행합니다.
     * @param {object} job - 활성 FIFO 작업입니다.
     * @param {object} context - 비트 맥락입니다.
     * @param {string[]} viewerIds - 게임이 허용한 시청자 ID입니다.
     * @param {string} cacheKey - 채팅 캐시 키입니다.
     * @returns {Promise<object>} 채팅 생성 결과입니다.
     * @private
     */
    async #executeChatRequest(job, context, viewerIds, cacheKey) {
        const cached = this.chatCache.get(cacheKey);
        if (cached) {
            this.#touchCacheEntry(cacheKey, cached);
            this.#setIdleStatus('AI 캐시');
            return { chats: cached.map((chat) => ({ ...chat })), source: 'cache' };
        }

        try {
            const requestBody = this.contract.buildChatRequestBody({
                ...context,
                viewerIds
            });
            const responseText = await this.#requestGemini(requestBody, job.modelId);
            if (!this.#isJobCurrent(job)) {
                return job.discardedResult();
            }

            const validated = this.contract.parseChatResponse(responseText, {
                ...context,
                viewerIds
            });
            if (!this.#isJobCurrent(job)) {
                return job.discardedResult();
            }
            const chats = validated.chats.map((chat) => ({ ...chat }));
            this.#setCacheEntry(cacheKey, chats);
            this.#setIdleStatus('AI 온라인');
            return { chats, source: 'model' };
        } catch (error) {
            if (!this.#isJobCurrent(job)) {
                return job.discardedResult();
            }
            this.#setIdleStatus('로컬 폴백');
            if (error?.name !== 'AbortError') {
                this.#reportSafeWarning('일반 채팅 생성', error);
            }
            return { chats: [], source: 'fallback' };
        }
    }

    /**
     * 플레이어 메시지 의도 공급자 요청 하나를 실행합니다.
     * @param {object} job - 활성 FIFO 작업입니다.
     * @param {object} context - 플레이어 메시지 맥락입니다.
     * @param {string[]} viewerIds - 게임이 허용한 시청자 ID입니다.
     * @returns {Promise<object>} 의도 판정 결과입니다.
     * @private
     */
    async #executeIntentRequest(job, context, viewerIds) {
        try {
            const requestBody = this.contract.buildIntentRequestBody({
                ...context,
                viewerIds
            });
            const responseText = await this.#requestGemini(requestBody, job.modelId);
            if (!this.#isJobCurrent(job)) {
                return job.discardedResult();
            }

            const validated = this.contract.parseIntentResponse(responseText, viewerIds);
            this.#setIdleStatus('AI 온라인');
            return {
                ...validated,
                reaction_chats: validated.reaction_chats.map((chat) => ({ ...chat })),
                source: 'model'
            };
        } catch (error) {
            if (!this.#isJobCurrent(job)) {
                return job.discardedResult();
            }
            if (this.#isProviderSafetyBlock(error)) {
                this.#setIdleStatus('안전 필터 차단');
                return {
                    intent: 'blocked',
                    confidence: 100,
                    reason: '안전 기준에 따라 전송할 수 없는 표현입니다.',
                    hero_reply: '',
                    hero_expression: 'idle',
                    callback_text: '',
                    reaction_chats: [],
                    source: 'provider-safety'
                };
            }
            this.#setIdleStatus('의도 판정 실패');
            if (error?.name !== 'AbortError') {
                this.#reportSafeWarning('자유 채팅 분류', error);
            }
            return {
                ...this.#buildTechnicalFailureResult(
                    'AI 판정을 완료하지 못해 메시지를 전송하지 않았습니다.'
                ),
                source: 'technical-failure'
            };
        }
    }

    /**
     * 작업이 현재 세대에서 계속 유효한지 확인합니다.
     * @param {object} job - 검사할 요청입니다.
     * @returns {boolean} 결과를 적용해도 되는지 여부입니다.
     * @private
     */
    #isJobCurrent(job) {
        return !this.destroyed && job.generation === this.generation;
    }

    /**
     * 각 호출자가 보유한 Promise를 정확히 한 번만 해소합니다.
     * @param {object} job - 완료할 요청입니다.
     * @param {object} result - 안전하게 정규화된 결과입니다.
     * @private
     */
    #settleJob(job, result) {
        if (!job || job.settled) {
            return;
        }
        job.settled = true;
        job.resolve(result);
    }

    /**
     * 실행 lane과 대기 건수를 사용해 UI 상태 문자열을 갱신합니다.
     * @private
     */
    #refreshStatus() {
        if (this.destroyed) {
            this.status = '종료됨';
            return;
        }
        const queuedCount = this.requestQueue.reduce(
            (count, job) => count + (job.settled ? 0 : 1),
            0
        );
        if (this.activeJob) {
            const activeLabel = this.activeJob.settled
                ? 'AI 요청 취소 정리 중'
                : (this.activeJob.lane === 'chat' ? '채팅 생성 중' : '의도 판정 중');
            this.status = queuedCount > 0
                ? `${activeLabel} · ${queuedCount}건 대기`
                : activeLabel;
            return;
        }
        if (queuedCount > 0) {
            this.status = `AI 요청 ${queuedCount}건 대기`;
            return;
        }
        this.status = this.idleStatus;
    }

    /**
     * 활성 요청이 없을 때 표시할 상태를 보존합니다.
     * @param {string} status - 한국어 상태 문자열입니다.
     * @private
     */
    #setIdleStatus(status) {
        this.idleStatus = status;
        this.#refreshStatus();
    }

    /**
     * 취소된 채팅 생성 요청의 공통 결과를 만듭니다.
     * @returns {{chats:Array,source:string,discarded:boolean}} 폐기 결과입니다.
     * @private
     */
    #buildDiscardedChatResult() {
        return { chats: [], source: 'discarded', discarded: true };
    }

    /**
     * 취소된 의도 판정 요청의 공통 결과를 만듭니다.
     * @returns {object} 사용 횟수를 소모하지 않는 폐기 결과입니다.
     * @private
     */
    #buildDiscardedIntentResult() {
        return {
            ...this.#buildTechnicalFailureResult('요청이 취소되어 메시지를 전송하지 않았습니다.'),
            source: 'discarded',
            discarded: true
        };
    }

    /**
     * Gemini generateContent를 호출하고 검증 전 응답 텍스트만 반환합니다.
     * @param {object} requestBody - 구조화 요청 본문입니다.
     * @param {string} modelId - 해당 FIFO 작업에 고정된 Gemini 모델 ID입니다.
     * @returns {Promise<string>} 후보 텍스트입니다.
     * @private
     */
    async #requestGemini(requestBody, modelId) {
        const apiKey = this.#readGeminiApiKey();
        const fetchImpl = this.fetchImpl
            || (typeof window !== 'undefined' ? window.fetch?.bind(window) : globalThis.fetch);
        if (typeof fetchImpl !== 'function') {
            throw new Error('FETCH_UNAVAILABLE');
        }

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
        const controller = new AbortController();
        const timeoutFunction = typeof window !== 'undefined' ? window.setTimeout.bind(window) : setTimeout;
        const clearTimeoutFunction = typeof window !== 'undefined' ? window.clearTimeout.bind(window) : clearTimeout;
        let timedOut = false;
        let abortListener = null;
        const abortGate = new Promise((_resolve, reject) => {
            abortListener = () => {
                if (timedOut) {
                    reject(new Error('REQUEST_TIMEOUT'));
                    return;
                }
                const abortError = new Error('REQUEST_ABORTED');
                abortError.name = 'AbortError';
                reject(abortError);
            };
            controller.signal.addEventListener('abort', abortListener, { once: true });
        });
        const timeoutId = timeoutFunction(
            () => {
                timedOut = true;
                controller.abort();
            },
            Math.max(1000, Number(this.rules.REQUEST_TIMEOUT_MS) || 8000)
        );
        this.controllers.add(controller);

        const providerPromise = (async () => {
            const response = await fetchImpl(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });
            const responseText = await response.text();
            if (responseText.length > MAX_RESPONSE_BYTES) {
                throw new Error('RESPONSE_TOO_LARGE');
            }
            if (!response.ok) {
                throw new Error(`HTTP_${response.status}`);
            }

            let responseBody;
            try {
                responseBody = JSON.parse(responseText);
            } catch (error) {
                throw new Error('INVALID_PROVIDER_JSON');
            }

            if (responseBody?.promptFeedback?.blockReason) {
                throw new Error('PROVIDER_SAFETY_BLOCK');
            }
            const candidate = responseBody?.candidates?.[0];
            if (!candidate) {
                throw new Error('MISSING_CANDIDATE');
            }
            const finishReason = String(candidate.finishReason || '');
            if (!ACCEPTED_FINISH_REASONS.has(finishReason)) {
                throw new Error(`FINISH_${finishReason || 'UNKNOWN'}`);
            }
            const parts = candidate?.content?.parts;
            if (!Array.isArray(parts)) {
                throw new Error('MISSING_CONTENT_PARTS');
            }
            const text = parts.map((part) => String(part?.text || '')).join('').trim();
            if (!text) {
                throw new Error('EMPTY_MODEL_RESPONSE');
            }
            return text;
        })();

        // Promise.race가 이미 끝난 뒤 공급자 구현이 늦게 reject해도 전역 unhandled가 되지 않습니다.
        void providerPromise.catch(() => {});

        try {
            return await Promise.race([providerPromise, abortGate]);
        } catch (error) {
            if (timedOut && error?.name === 'AbortError') {
                throw new Error('REQUEST_TIMEOUT');
            }
            throw error;
        } finally {
            clearTimeoutFunction(timeoutId);
            if (abortListener) {
                controller.signal.removeEventListener('abort', abortListener);
            }
            this.controllers.delete(controller);
        }
    }

    /**
     * 프로젝트 루트 후보에서 Gemini API 키를 읽습니다.
     * @returns {string} API 키입니다.
     * @private
     */
    #readGeminiApiKey() {
        const nodeRequire = this.#getNodeRequire();
        if (!nodeRequire) {
            throw new Error('API_KEY_NODE_ACCESS_UNAVAILABLE');
        }

        const fs = nodeRequire('fs');
        const path = nodeRequire('path');
        for (const candidate of this.#buildApiKeyPathCandidates(path)) {
            if (!fs.existsSync(candidate)) {
                continue;
            }
            const apiKey = fs.readFileSync(candidate, 'utf8').trim();
            if (!apiKey || apiKey === 'PUT_YOUR_GEMINI_API_KEY_HERE') {
                throw new Error('API_KEY_EMPTY');
            }
            return apiKey;
        }

        throw new Error('API_KEY_NOT_FOUND');
    }

    /**
     * NW.js 또는 Node require 함수를 반환합니다.
     * @returns {Function|null} require 함수입니다.
     * @private
     */
    #getNodeRequire() {
        if (typeof window !== 'undefined' && typeof window.require === 'function') {
            return window.require;
        }
        if (typeof require === 'function') {
            return require;
        }
        return null;
    }

    /**
     * API 키 파일의 플랫폼별 후보 경로를 반환합니다.
     * @param {object} path - Node path 모듈입니다.
     * @returns {string[]} 중복 제거된 경로입니다.
     * @private
     */
    #buildApiKeyPathCandidates(path) {
        const candidates = [];
        const nwObject = typeof window !== 'undefined'
            ? (window.nw || (typeof nw !== 'undefined' ? nw : null))
            : null;

        if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
            candidates.push(path.join(process.cwd(), 'api_key.txt'));
            candidates.push(path.join(process.cwd(), '..', 'api_key.txt'));
        }
        if (nwObject?.App?.startPath) {
            candidates.push(path.join(nwObject.App.startPath, 'api_key.txt'));
            candidates.push(path.join(nwObject.App.startPath, '..', 'api_key.txt'));
        }
        candidates.push(path.resolve('api_key.txt'));
        candidates.push(path.resolve('..', 'api_key.txt'));
        return [...new Set(candidates)];
    }

    /**
     * 런타임 또는 콘텐츠에서 전달한 시청자 ID 목록을 정리합니다.
     * @param {object} context - 요청 맥락입니다.
     * @returns {string[]} 시청자 ID입니다.
     * @private
     */
    #resolveViewerIds(context) {
        const fromContext = Array.isArray(context?.viewerIds) ? context.viewerIds : [];
        const fromFallback = Array.isArray(context?.fallbackChats)
            ? context.fallbackChats.map((chat) => chat.viewerId || chat.viewer_id || chat.nickname)
            : [];
        const ids = [...fromContext, ...fromFallback]
            .map((value) => String(value || '').normalize('NFKC').trim())
            .filter(Boolean);
        const uniqueIds = [...new Set(ids)].slice(0, 12);
        return uniqueIds.length > 0 ? uniqueIds : ['aqua_fan', 'cloud_note', 'bubble_pop'];
    }

    /**
     * 요청 lane에 지정된 실제 Gemini 모델 ID를 반환합니다.
     * @param {'chat'|'intent'} lane - 공급자 요청 종류입니다.
     * @returns {string} endpoint와 캐시 키에 함께 사용할 모델 ID입니다.
     * @private
     */
    #resolveModelId(lane) {
        const configured = lane === 'chat'
            ? this.rules.CHAT_API_MODEL
            : this.rules.INTENT_API_MODEL;
        const modelId = String(configured || this.rules.API_MODEL || '').trim();
        if (!modelId) {
            throw new Error('API_MODEL_NOT_CONFIGURED');
        }
        return modelId;
    }

    /**
     * 캐시 키를 현재 모델과 프롬프트 버전까지 포함해 만듭니다.
     * @param {string} lane - 요청 종류입니다.
     * @param {object} payload - 키 데이터입니다.
     * @param {string} modelId - 해당 요청이 실제 사용하는 모델 ID입니다.
     * @returns {string} 캐시 키입니다.
     * @private
     */
    #buildCacheKey(lane, payload, modelId) {
        return JSON.stringify({
            lane,
            schema: this.rules.SCHEMA_VERSION,
            prompt: this.rules.PROMPT_REVISION,
            model: modelId,
            payload
        });
    }

    /**
     * 최대 엔트리 수를 지키며 메모리 캐시에 결과를 넣습니다.
     * @param {string} key - 캐시 키입니다.
     * @param {Array} value - 채팅 배열입니다.
     * @private
     */
    #setCacheEntry(key, value) {
        this.chatCache.set(key, value.map((chat) => Object.freeze({ ...chat })));
        const maxEntries = Math.max(1, Number(this.rules.MAX_CACHE_ENTRIES) || 48);
        while (this.chatCache.size > maxEntries) {
            const oldestKey = this.chatCache.keys().next().value;
            this.chatCache.delete(oldestKey);
        }
    }

    /**
     * 읽은 캐시 엔트리를 가장 최근 위치로 이동합니다.
     * @param {string} key - 캐시 키입니다.
     * @param {Array} value - 캐시 값입니다.
     * @private
     */
    #touchCacheEntry(key, value) {
        this.chatCache.delete(key);
        this.chatCache.set(key, value);
    }

    /**
     * 비밀정보와 원문을 포함하지 않는 짧은 경고만 한정적으로 기록합니다.
     * @param {string} label - 작업 라벨입니다.
     * @param {Error} error - 발생 오류입니다.
     * @private
     */
    #reportSafeWarning(label, error) {
        const safeCode = String(error?.message || error || 'UNKNOWN_ERROR')
            .replace(/[A-Za-z0-9_-]{24,}/g, '[REDACTED]')
            .slice(0, 120);
        if (safeCode.startsWith('API_KEY_')) {
            if (this.hasReportedKeyError) {
                return;
            }
            this.hasReportedKeyError = true;
        }
        console.warn(`[AeroLiveAiService] ${label} 폴백: ${safeCode}`);
    }

    /**
     * 공급자가 안전 또는 개인정보 이유로 응답을 차단했는지 판정합니다.
     * @param {Error} error - 전송 또는 응답 처리 오류입니다.
     * @returns {boolean} 안전 차단 여부입니다.
     * @private
     */
    #isProviderSafetyBlock(error) {
        const code = String(error?.message || error || '').toUpperCase();
        return code === 'PROVIDER_SAFETY_BLOCK'
            || code === 'FINISH_SAFETY'
            || code === 'FINISH_PROHIBITED_CONTENT'
            || code === 'FINISH_SPII'
            || code === 'FINISH_BLOCKLIST';
    }

    /**
     * 기술 실패 때 사용 횟수를 소모하지 않도록 전송 보류 결과를 만듭니다.
     * @param {string} reason - 사용자에게 보여줄 안전한 사유입니다.
     * @returns {{intent:string,confidence:number,reason:string,hero_reply:string,hero_expression:string,callback_text:string,reaction_chats:Array}} 전송 보류 결과입니다.
     * @private
     */
    #buildTechnicalFailureResult(reason) {
        return {
            intent: 'blocked',
            confidence: 0,
            reason,
            hero_reply: '',
            hero_expression: 'idle',
            callback_text: '',
            reaction_chats: []
        };
    }
}
