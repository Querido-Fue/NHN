import { getData } from 'data/data_handler.js';
import { AeroLiveLlmContract } from './_aero_live_llm_contract.mjs';

const AI_CONSTANTS = getData('AERO_LIVE_SCENE_CONSTANTS').AI;
const AERO_LIVE_PROXY_URL = 'https://api.jukchang.com/v1/aero-live';
const AERO_LIVE_PROXY_VERSION = 'aero-live-proxy-v1';
const MAX_PROXY_RESPONSE_BYTES = 96 * 1024;
const SAFE_PROXY_ERROR_CODES = new Set([
    'INVALID_ORIGIN', 'INVALID_METHOD', 'INVALID_CONTENT_TYPE', 'INVALID_JSON',
    'INVALID_VERSION', 'INVALID_LANE', 'INVALID_REQUEST_ID', 'INVALID_SESSION',
    'INVALID_CONTEXT', 'REQUEST_TOO_LARGE', 'RATE_LIMITED', 'UPSTREAM_TIMEOUT',
    'UPSTREAM_UNAVAILABLE', 'UPSTREAM_REJECTED', 'PROVIDER_SAFETY_BLOCK',
    'INVALID_PROVIDER_RESPONSE', 'INTERNAL_ERROR'
]);

/**
 * AERO LIVE의 일반 채팅 생성과 플레이어 입력 분류를 서버 프록시에 연결합니다.
 * 일반 채팅 실패는 빈 배치로 폴백하고, 플레이어 입력 판정 실패는 전송을 보류합니다.
 */
export class AeroLiveAiService {
    /**
     * @param {{rules?:object, fetchImpl?:Function, gameSession?:string}} [options={}] - 테스트 또는 런타임 주입 옵션입니다.
     */
    constructor(options = {}) {
        this.rules = options.rules || AI_CONSTANTS;
        this.fetchImpl = options.fetchImpl || null;
        this.gameSession = this.#resolveGameSession(options.gameSession);
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
        let proxyContext;
        try {
            proxyContext = this.#buildChatProxyContext(context, viewerIds);
        } catch (error) {
            this.#setIdleStatus('로컬 폴백');
            this.#reportSafeWarning('일반 채팅 요청 정리', error);
            return { chats: [], source: 'fallback' };
        }
        const cacheKey = this.#buildCacheKey('chat', proxyContext);
        const cached = this.chatCache.get(cacheKey);
        if (cached) {
            this.#touchCacheEntry(cacheKey, cached);
            this.#setIdleStatus('AI 캐시');
            return { chats: cached.map((chat) => ({ ...chat })), source: 'cache' };
        }

        return this.#enqueueRequest({
            lane: 'chat',
            execute: (job) => this.#executeChatRequest(
                job,
                proxyContext,
                cacheKey
            ),
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
        let proxyContext;
        try {
            proxyContext = this.#buildIntentProxyContext(context, viewerIds);
        } catch (error) {
            this.#setIdleStatus('의도 판정 실패');
            this.#reportSafeWarning('자유 채팅 요청 정리', error);
            return {
                ...this.#buildTechnicalFailureResult(
                    'AI 판정을 시작할 수 없어 메시지를 전송하지 않았습니다.'
                ),
                source: 'technical-failure'
            };
        }
        return this.#enqueueRequest({
            lane: 'intent',
            execute: (job) => this.#executeIntentRequest(job, proxyContext),
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
     * 일반 채팅 프록시 요청 하나를 실행합니다.
     * @param {object} job - 활성 FIFO 작업입니다.
     * @param {object} proxyContext - Worker로 보낼 최소 방송 맥락입니다.
     * @param {string} cacheKey - 채팅 캐시 키입니다.
     * @returns {Promise<object>} 채팅 생성 결과입니다.
     * @private
     */
    async #executeChatRequest(job, proxyContext, cacheKey) {
        const cached = this.chatCache.get(cacheKey);
        if (cached) {
            this.#touchCacheEntry(cacheKey, cached);
            this.#setIdleStatus('AI 캐시');
            return { chats: cached.map((chat) => ({ ...chat })), source: 'cache' };
        }

        try {
            const responseText = await this.#requestProxy('chat', proxyContext);
            if (!this.#isJobCurrent(job)) {
                return job.discardedResult();
            }

            const validated = this.contract.parseChatResponse(
                responseText,
                proxyContext
            );
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
     * @param {object} proxyContext - Worker로 보낼 최소 방송 맥락입니다.
     * @returns {Promise<object>} 의도 판정 결과입니다.
     * @private
     */
    async #executeIntentRequest(job, proxyContext) {
        try {
            const responseText = await this.#requestProxy('intent', proxyContext);
            if (!this.#isJobCurrent(job)) {
                return job.discardedResult();
            }

            const validated = this.contract.parseIntentResponse(
                responseText,
                proxyContext.viewerIds
            );
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
     * Worker API를 호출하고 Worker가 이미 검증한 strict JSON만 반환합니다.
     * Gemini endpoint, 모델, systemInstruction, generationConfig는 브라우저에서 만들지 않습니다.
     * @param {'chat'|'intent'} lane - Worker lane입니다.
     * @param {object} context - Worker 계약에 맞춘 최소 게임 맥락입니다.
     * @returns {Promise<string>} Worker가 검증한 strict JSON 문자열입니다.
     * @private
     */
    async #requestProxy(lane, context) {
        const fetchImpl = this.fetchImpl
            || (typeof window !== 'undefined' ? window.fetch?.bind(window) : globalThis.fetch);
        if (typeof fetchImpl !== 'function') {
            throw new Error('FETCH_UNAVAILABLE');
        }

        const requestId = this.#createRequestId();
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

        const proxyPromise = (async () => {
            const response = await fetchImpl(AERO_LIVE_PROXY_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Game-Session': this.gameSession
                },
                body: JSON.stringify({
                    version: AERO_LIVE_PROXY_VERSION,
                    requestId,
                    lane,
                    context
                }),
                signal: controller.signal
            });
            const responseText = await response.text();
            if (new TextEncoder().encode(responseText).byteLength > MAX_PROXY_RESPONSE_BYTES) {
                throw new Error('PROXY_RESPONSE_TOO_LARGE');
            }
            let responseBody;
            try {
                responseBody = JSON.parse(responseText);
            } catch {
                throw new Error('PROXY_INVALID_RESPONSE');
            }
            const safeCode = String(responseBody?.error?.code || '');
            if (!response.ok || responseBody?.ok !== true) {
                throw new Error(
                    SAFE_PROXY_ERROR_CODES.has(safeCode)
                        ? `PROXY_${safeCode}`
                        : 'PROXY_INTERNAL_ERROR'
                );
            }
            if (responseBody.version !== AERO_LIVE_PROXY_VERSION
                || responseBody.requestId !== requestId
                || responseBody.lane !== lane
                || typeof responseBody.text !== 'string') {
                throw new Error('PROXY_INVALID_RESPONSE');
            }
            return responseBody.text;
        })();

        // abort 뒤 프록시 구현이 늦게 reject해도 전역 unhandled로 남기지 않습니다.
        void proxyPromise.catch(() => {});

        try {
            return await Promise.race([proxyPromise, abortGate]);
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
     * Worker 요청에서 사용할 메모리 전용 게임 세션 ID를 반환합니다.
     * @param {*} value - 테스트에서 주입할 ID입니다.
     * @returns {string} 안전한 세션 ID입니다.
     * @private
     */
    #resolveGameSession(value) {
        const supplied = String(value || '');
        if (/^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/u.test(supplied)) {
            return supplied;
        }
        const randomId = globalThis.crypto?.randomUUID?.()
            || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
        return `aero_${randomId}`;
    }

    /**
     * 현재 탭 수명에만 연결된 requestId를 만듭니다.
     * @returns {string} Worker 요청 ID입니다.
     * @private
     */
    #createRequestId() {
        this.proxyRequestSequence = (this.proxyRequestSequence || 0) + 1;
        return `${this.gameSession}_r${this.proxyRequestSequence}`;
    }

    /**
     * Worker의 chat 허용 필드만 새 객체로 만듭니다.
     * @param {object} context - 장면 맥락입니다.
     * @param {string[]} viewerIds - 게임이 허용한 시청자 ID입니다.
     * @returns {object} 최소 chat context입니다.
     * @private
     */
    #buildChatProxyContext(context, viewerIds) {
        const toText = (value, maxChars) => Array.from(String(value ?? '')
            .normalize('NFKC')
            .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034f]/gu, ' ')
            .replace(/\s+/gu, ' ')
            .trim())
            .slice(0, maxChars)
            .join('');
        const toChats = (values, maxItems, includeViewerId) => (
            Array.isArray(values) ? values.slice(0, maxItems).map((chat) => {
                const sentiment = ['positive', 'negative', 'neutral'].includes(chat?.sentiment)
                    ? chat.sentiment
                    : 'neutral';
                const safeChat = { sentiment, text: toText(chat?.text, 180) };
                if (includeViewerId) {
                    safeChat.viewerId = toText(
                        chat?.viewerId || chat?.viewer_id || chat?.nickname,
                        24
                    );
                }
                return safeChat;
            }) : []
        );
        const activeEvent = context?.activeEvent && typeof context.activeEvent === 'object'
            ? {
                id: toText(context.activeEvent.id, 80),
                kind: toText(context.activeEvent.kind || context.activeEvent.type, 24),
                text: toText(context.activeEvent.text, 180),
                tone: toText(context.activeEvent.tone || context.activeEvent.sentiment, 24)
            }
            : null;
        return {
            topicId: toText(context?.topicId, 40),
            topicTitle: toText(context?.topicTitle ?? context?.topic?.title ?? context?.topic, 80),
            topicConcept: toText(context?.topicConcept ?? context?.topic?.concept, 180),
            beatId: toText(context?.beatId, 80),
            beatIndex: Math.max(0, Math.min(999, Math.floor(Number(context?.beatIndex) || 0))),
            beatCount: Math.max(0, Math.min(999, Math.floor(Number(context?.beatCount) || 0))),
            heroText: toText(context?.heroText, 240),
            mood: toText(context?.mood, 40),
            activeEvent,
            opinion: Math.max(-100, Math.min(100, Math.round(Number(context?.opinion) || 0))),
            referenceChats: toChats(context?.referenceChats, 12, false),
            fallbackChats: toChats(context?.fallbackChats, 16, true),
            viewerIds: viewerIds.map((viewerId) => toText(viewerId, 24)).filter(Boolean)
        };
    }

    /**
     * Worker의 intent 허용 필드만 새 객체로 만듭니다.
     * @param {object} context - 플레이어 입력 맥락입니다.
     * @param {string[]} viewerIds - 게임이 허용한 시청자 ID입니다.
     * @returns {object} 최소 intent context입니다.
     * @private
     */
    #buildIntentProxyContext(context, viewerIds) {
        const toText = (value, maxChars) => Array.from(String(value ?? '')
            .normalize('NFKC')
            .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034f]/gu, ' ')
            .replace(/\s+/gu, ' ')
            .trim())
            .slice(0, maxChars)
            .join('');
        return {
            message: toText(context?.message, 140),
            topic: toText(context?.topic, 40),
            heroText: toText(context?.heroText, 240),
            coreChatText: toText(context?.coreChatText, 140),
            coreChatViewerId: toText(context?.coreChatViewerId, 24),
            viewerIds: viewerIds.map((viewerId) => toText(viewerId, 24)).filter(Boolean)
        };
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
     * 캐시 키를 프록시에 전달한 최소 맥락과 계약 버전으로 만듭니다.
     * @param {string} lane - 요청 종류입니다.
     * @param {object} payload - 키 데이터입니다.
     * @returns {string} 캐시 키입니다.
     * @private
     */
    #buildCacheKey(lane, payload) {
        return JSON.stringify({
            lane,
            schema: this.rules.SCHEMA_VERSION,
            prompt: this.rules.PROMPT_REVISION,
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
        const candidate = String(error?.message || error || 'UNKNOWN_ERROR');
        const safeCode = SAFE_PROXY_ERROR_CODES.has(candidate.replace(/^PROXY_/u, ''))
            ? candidate
            : 'REQUEST_FAILED';
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
            || code === 'PROXY_PROVIDER_SAFETY_BLOCK';
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
