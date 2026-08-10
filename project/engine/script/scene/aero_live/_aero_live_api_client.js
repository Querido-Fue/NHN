const SAFE_PROXY_ERROR_CODES = new Set([
    'INVALID_ORIGIN', 'INVALID_METHOD', 'INVALID_CONTENT_TYPE', 'INVALID_JSON',
    'INVALID_VERSION', 'INVALID_LANE', 'INVALID_REQUEST_ID', 'INVALID_SESSION',
    'INVALID_CONTEXT', 'REQUEST_TOO_LARGE', 'RATE_LIMITED', 'UPSTREAM_TIMEOUT',
    'UPSTREAM_UNAVAILABLE', 'UPSTREAM_REJECTED', 'PROVIDER_SAFETY_BLOCK',
    'INVALID_PROVIDER_RESPONSE', 'INTERNAL_ERROR'
]);

function createSecureIdentifier(prefix) {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return `${prefix}_${globalThis.crypto.randomUUID()}`;
    }
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    }
    throw new Error('SECURE_RANDOM_UNAVAILABLE');
}

function responseContentTypeIsJson(response) {
    const contentType = response?.headers?.get?.('content-type') || '';
    return contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
}

/**
 * AERO LIVE Worker의 공개 HTTP 계약만 담당합니다. Gemini 또는 API key 관련
 * 정보를 알지 못하며, 네트워크 원문을 console에 기록하지 않습니다.
 */
export class AeroLiveApiClient {
    /**
     * @param {{proxyUrl:string, proxyVersion:string, timeoutMs:number, maxResponseBytes:number, fetchImpl?:Function, sessionId?:string}} options - 공개 프록시 설정입니다.
     */
    constructor(options) {
        this.proxyUrl = String(options?.proxyUrl || '');
        this.proxyVersion = String(options?.proxyVersion || '');
        this.timeoutMs = Math.max(1000, Number(options?.timeoutMs) || 8000);
        this.maxResponseBytes = Math.max(1024, Number(options?.maxResponseBytes) || (96 * 1024));
        this.fetchImpl = options?.fetchImpl || null;
        this.sessionId = this.#resolveSessionId(options?.sessionId);
        this.requestSequence = 0;
        this.controllers = new Set();
        this.destroyed = false;
    }

    /**
     * Worker에 최소 게임 context를 POST하고, 검증 전 strict JSON text만 반환합니다.
     * @param {'chat'|'intent'} lane - 실행 lane입니다.
     * @param {object} context - 호출부가 선별한 평범한 JSON context입니다.
     * @returns {Promise<string>} Worker가 반환한 strict JSON text입니다.
     */
    async request(lane, context) {
        if (this.destroyed) {
            throw new Error('REQUEST_ABORTED');
        }
        if (lane !== 'chat' && lane !== 'intent') {
            throw new Error('PROXY_INVALID_LANE');
        }
        if (!this.proxyUrl || !this.proxyVersion) {
            throw new Error('PROXY_CONFIGURATION_ERROR');
        }
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
                const error = new Error('REQUEST_ABORTED');
                error.name = 'AbortError';
                reject(error);
            };
            controller.signal.addEventListener('abort', abortListener, { once: true });
        });
        const timeoutId = timeoutFunction(() => {
            timedOut = true;
            controller.abort();
        }, this.timeoutMs);
        this.controllers.add(controller);

        const requestPromise = (async () => {
            const response = await fetchImpl(this.proxyUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Game-Session': this.sessionId
                },
                credentials: 'omit',
                body: JSON.stringify({
                    version: this.proxyVersion,
                    requestId,
                    lane,
                    context
                }),
                signal: controller.signal
            });
            if (!responseContentTypeIsJson(response)) {
                throw new Error('PROXY_INVALID_CONTENT_TYPE');
            }
            const responseText = await response.text();
            if (byteLength(responseText) > this.maxResponseBytes) {
                throw new Error('PROXY_RESPONSE_TOO_LARGE');
            }
            let body;
            try {
                body = JSON.parse(responseText);
            } catch {
                throw new Error('PROXY_INVALID_JSON');
            }
            if (body?.version !== this.proxyVersion || body?.requestId !== requestId) {
                throw new Error('PROXY_INVALID_RESPONSE');
            }
            if (response.ok && body?.ok === true) {
                if (body.lane !== lane || typeof body.text !== 'string') {
                    throw new Error('PROXY_INVALID_RESPONSE');
                }
                return body.text;
            }
            const code = String(body?.error?.code || '');
            throw new Error(SAFE_PROXY_ERROR_CODES.has(code)
                ? `PROXY_${code}`
                : 'PROXY_INTERNAL_ERROR');
        })();

        // A fetch implementation may reject after abort/timeout. Keep that
        // late rejection observed so it never becomes an unhandled rejection.
        void requestPromise.catch(() => {});

        try {
            return await Promise.race([requestPromise, abortGate]);
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

    /** Cancel every in-flight Worker request for this game-tab session. */
    abortAll() {
        for (const controller of this.controllers) {
            controller.abort();
        }
        this.controllers.clear();
    }

    /** End this client lifetime and prevent new requests. */
    destroy() {
        this.destroyed = true;
        this.abortAll();
    }

    #resolveSessionId(value) {
        const supplied = String(value || '');
        if (/^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/u.test(supplied)) {
            return supplied;
        }
        return createSecureIdentifier('aero');
    }

    #createRequestId() {
        this.requestSequence += 1;
        return `${this.sessionId}_r${this.requestSequence}`;
    }
}
