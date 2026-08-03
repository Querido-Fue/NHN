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
        this.chatRequestSequence = 0;
        this.intentRequestSequence = 0;
        this.generation = 0;
        this.chatBusy = false;
        this.intentBusy = false;
        this.destroyed = false;
        this.status = this.rules.ENABLED === false ? '로컬 모드' : 'AI 준비';
        this.hasReportedKeyError = false;
    }

    /**
     * 현재 AI 연결 상태를 짧은 UI 문자열로 반환합니다.
     * @returns {string} 상태 문자열입니다.
     */
    getStatus() {
        return this.status;
    }

    /**
     * 장면 맥락에 맞는 일반 채팅을 배치로 생성합니다.
     * @param {object} context - beat-started 이벤트 맥락입니다.
     * @returns {Promise<{chats:Array,source:string}>} 생성 결과입니다.
     */
    async generateChatBatch(context) {
        if (this.destroyed || this.rules.ENABLED === false) {
            return { chats: [], source: 'local-only' };
        }
        if (this.chatBusy) {
            return { chats: [], source: 'busy' };
        }

        const viewerIds = this.#resolveViewerIds(context);
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
        });
        const cached = this.chatCache.get(cacheKey);
        if (cached) {
            this.#touchCacheEntry(cacheKey, cached);
            this.status = 'AI 캐시';
            return { chats: cached.map((chat) => ({ ...chat })), source: 'cache' };
        }

        this.chatBusy = true;
        this.chatRequestSequence += 1;
        const requestId = this.chatRequestSequence;
        this.status = '채팅 생성 중';
        const requestGeneration = this.generation;

        try {
            const requestBody = this.contract.buildChatRequestBody({
                ...context,
                viewerIds
            });
            const responseText = await this.#requestGemini(requestBody);
            if (this.destroyed
                || requestGeneration !== this.generation
                || requestId !== this.chatRequestSequence) {
                return { chats: [], source: 'discarded' };
            }

            const validated = this.contract.parseChatResponse(responseText, {
                ...context,
                viewerIds
            });
            const chats = validated.chats.map((chat) => ({ ...chat }));
            this.#setCacheEntry(cacheKey, chats);
            this.status = 'AI 온라인';
            return { chats, source: 'model' };
        } catch (error) {
            if (this.destroyed
                || requestGeneration !== this.generation
                || requestId !== this.chatRequestSequence) {
                return { chats: [], source: 'discarded' };
            }
            if (error?.name !== 'AbortError') {
                this.status = '로컬 폴백';
                this.#reportSafeWarning('일반 채팅 생성', error);
            }
            return { chats: [], source: 'fallback' };
        } finally {
            if (requestGeneration === this.generation && requestId === this.chatRequestSequence) {
                this.chatBusy = false;
            }
        }
    }

    /**
     * 플레이어 위장 채팅을 기획서의 다섯 의도 중 하나로 분류합니다.
     * @param {object} context - 메시지와 현재 방송 맥락입니다.
     * @returns {Promise<{intent:string,confidence:number,reason:string,reaction_chats:Array,source:string}>} 분류 결과입니다.
     */
    async classifyPlayerMessage(context) {
        const localResult = this.contract.classifyLocally(context?.message || '');
        if (localResult.intent === 'blocked') {
            this.status = '안전 필터 차단';
            return { ...localResult, reaction_chats: [], source: 'local-safety' };
        }
        if (this.destroyed) {
            return {
                ...this.#buildTechnicalFailureResult('요청이 취소되어 메시지를 전송하지 않았습니다.'),
                source: 'discarded',
                discarded: true
            };
        }
        if (this.rules.ENABLED === false || this.intentBusy) {
            this.status = '의도 판정 보류';
            return {
                ...this.#buildTechnicalFailureResult('AI 판정을 시작할 수 없어 메시지를 전송하지 않았습니다.'),
                source: 'technical-failure'
            };
        }

        this.intentBusy = true;
        this.intentRequestSequence += 1;
        const requestId = this.intentRequestSequence;
        const requestGeneration = this.generation;
        const viewerIds = this.#resolveViewerIds(context);
        this.status = '의도 판정 중';

        try {
            const requestBody = this.contract.buildIntentRequestBody({
                ...context,
                viewerIds
            });
            const responseText = await this.#requestGemini(requestBody);
            if (this.destroyed
                || requestGeneration !== this.generation
                || requestId !== this.intentRequestSequence) {
                return {
                    ...this.#buildTechnicalFailureResult('요청이 취소되어 메시지를 전송하지 않았습니다.'),
                    source: 'discarded',
                    discarded: true
                };
            }

            const validated = this.contract.parseIntentResponse(responseText, viewerIds);
            this.status = 'AI 온라인';
            return {
                ...validated,
                reaction_chats: validated.reaction_chats.map((chat) => ({ ...chat })),
                source: 'model'
            };
        } catch (error) {
            if (this.destroyed
                || requestGeneration !== this.generation
                || requestId !== this.intentRequestSequence) {
                return {
                    ...this.#buildTechnicalFailureResult('요청이 취소되어 메시지를 전송하지 않았습니다.'),
                    source: 'discarded',
                    discarded: true
                };
            }
            if (this.#isProviderSafetyBlock(error)) {
                this.status = '안전 필터 차단';
                return {
                    intent: 'blocked',
                    confidence: 100,
                    reason: '안전 기준에 따라 전송할 수 없는 표현입니다.',
                    reaction_chats: [],
                    source: 'provider-safety'
                };
            }
            if (error?.name !== 'AbortError') {
                this.status = '의도 판정 실패';
                this.#reportSafeWarning('자유 채팅 분류', error);
            }
            return {
                ...this.#buildTechnicalFailureResult('AI 판정을 완료하지 못해 메시지를 전송하지 않았습니다.'),
                source: 'technical-failure'
            };
        } finally {
            if (requestGeneration === this.generation && requestId === this.intentRequestSequence) {
                this.intentBusy = false;
            }
        }
    }

    /**
     * 진행 중인 모든 Gemini 요청을 취소하고 늦게 도착한 결과를 무효화합니다.
     */
    abortAll() {
        this.generation += 1;
        this.chatRequestSequence += 1;
        this.intentRequestSequence += 1;
        for (const controller of this.controllers) {
            controller.abort();
        }
        this.controllers.clear();
        this.chatBusy = false;
        this.intentBusy = false;
    }

    /**
     * 서비스 수명주기를 종료합니다.
     */
    destroy() {
        this.destroyed = true;
        this.abortAll();
        this.chatCache.clear();
        this.status = '종료됨';
    }

    /**
     * Gemini generateContent를 호출하고 검증 전 응답 텍스트만 반환합니다.
     * @param {object} requestBody - 구조화 요청 본문입니다.
     * @returns {Promise<string>} 후보 텍스트입니다.
     * @private
     */
    async #requestGemini(requestBody) {
        const apiKey = this.#readGeminiApiKey();
        const fetchImpl = this.fetchImpl
            || (typeof window !== 'undefined' ? window.fetch?.bind(window) : globalThis.fetch);
        if (typeof fetchImpl !== 'function') {
            throw new Error('FETCH_UNAVAILABLE');
        }

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.rules.API_MODEL)}:generateContent`;
        const controller = new AbortController();
        const timeoutFunction = typeof window !== 'undefined' ? window.setTimeout.bind(window) : setTimeout;
        const clearTimeoutFunction = typeof window !== 'undefined' ? window.clearTimeout.bind(window) : clearTimeout;
        let timedOut = false;
        const timeoutId = timeoutFunction(
            () => {
                timedOut = true;
                controller.abort();
            },
            Math.max(1000, Number(this.rules.REQUEST_TIMEOUT_MS) || 8000)
        );
        this.controllers.add(controller);

        try {
            let response;
            try {
                response = await fetchImpl(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': apiKey
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                });
            } catch (error) {
                if (timedOut && error?.name === 'AbortError') {
                    throw new Error('REQUEST_TIMEOUT');
                }
                throw error;
            }
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
        } catch (error) {
            if (timedOut && error?.name === 'AbortError') {
                throw new Error('REQUEST_TIMEOUT');
            }
            throw error;
        } finally {
            clearTimeoutFunction(timeoutId);
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
     * 캐시 키를 현재 모델과 프롬프트 버전까지 포함해 만듭니다.
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
            model: this.rules.API_MODEL,
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
     * @returns {{intent:string,confidence:number,reason:string,reaction_chats:Array}} 전송 보류 결과입니다.
     * @private
     */
    #buildTechnicalFailureResult(reason) {
        return {
            intent: 'blocked',
            confidence: 0,
            reason,
            reaction_chats: []
        };
    }
}
