import { AeroLiveLlmContract } from '../../project/engine/script/scene/aero_live/_aero_live_llm_contract.mjs';
import {
    AERO_LIVE_PROXY_ORIGIN,
    AERO_LIVE_PROXY_PATH,
    AERO_LIVE_PROXY_VERSION,
    GEMINI_GENERATE_CONTENT_BASE_URL,
    MODEL_BY_LANE,
    RATE_LIMIT_BINDINGS,
    REQUEST_LIMITS,
    SERVER_AI_RULES
} from './config.js';
import {
    RequestValidationError,
    getSafeRequestId,
    isJsonContentType,
    parseAndSanitizeEnvelope,
    parseGameSession,
    sourceIpKey
} from './validation.js';

const ACCEPTED_FINISH_REASONS = new Set(['STOP', 'FINISH_REASON_UNSPECIFIED', '']);
const SAFETY_FINISH_REASONS = new Set([
    'SAFETY',
    'PROHIBITED_CONTENT',
    'SPII',
    'BLOCKLIST'
]);
const ERROR_STATUS = Object.freeze({
    INVALID_ORIGIN: 403,
    INVALID_METHOD: 405,
    INVALID_CONTENT_TYPE: 415,
    INVALID_JSON: 400,
    INVALID_VERSION: 400,
    INVALID_LANE: 400,
    INVALID_REQUEST_ID: 400,
    INVALID_SESSION: 400,
    INVALID_CONTEXT: 400,
    REQUEST_TOO_LARGE: 413,
    RATE_LIMITED: 429,
    UPSTREAM_TIMEOUT: 504,
    UPSTREAM_UNAVAILABLE: 503,
    UPSTREAM_REJECTED: 502,
    PROVIDER_SAFETY_BLOCK: 422,
    INVALID_PROVIDER_RESPONSE: 502,
    INTERNAL_ERROR: 500,
    NOT_FOUND: 404
});
const RETRYABLE_CODES = new Set([
    'RATE_LIMITED',
    'UPSTREAM_TIMEOUT',
    'UPSTREAM_UNAVAILABLE',
    'INTERNAL_ERROR'
]);

class ProxyError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function corsHeaders(origin) {
    if (origin !== AERO_LIVE_PROXY_ORIGIN) {
        return {};
    }
    return {
        'Access-Control-Allow-Origin': AERO_LIVE_PROXY_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Game-Session',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin'
    };
}

function responseHeaders(origin) {
    return {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...corsHeaders(origin)
    };
}

function jsonResponse(body, status, origin, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...responseHeaders(origin),
            ...extraHeaders
        }
    });
}

function failureResponse(code, requestId, origin) {
    const normalizedCode = ERROR_STATUS[code] ? code : 'INTERNAL_ERROR';
    const headers = normalizedCode === 'RATE_LIMITED' ? { 'Retry-After': '60' } : {};
    return jsonResponse({
        ok: false,
        version: AERO_LIVE_PROXY_VERSION,
        requestId: requestId || null,
        error: {
            code: normalizedCode,
            retryable: RETRYABLE_CODES.has(normalizedCode)
        }
    }, ERROR_STATUS[normalizedCode], origin, headers);
}

function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
}

function declaredLengthExceeds(contentLength, maxBytes) {
    if (!contentLength || !/^\d+$/u.test(contentLength)) {
        return false;
    }
    return Number(contentLength) > maxBytes;
}

async function readStreamText(stream, maxBytes) {
    if (!stream) {
        return '';
    }
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new ProxyError('REQUEST_TOO_LARGE');
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(joined);
}

async function readRequestJson(request) {
    if (declaredLengthExceeds(
        request.headers.get('content-length'),
        REQUEST_LIMITS.MAX_BODY_BYTES
    )) {
        throw new ProxyError('REQUEST_TOO_LARGE');
    }
    const source = await readStreamText(request.body, REQUEST_LIMITS.MAX_BODY_BYTES);
    try {
        return JSON.parse(source);
    } catch {
        throw new ProxyError('INVALID_JSON');
    }
}

async function readProviderText(response) {
    if (declaredLengthExceeds(
        response.headers.get('content-length'),
        REQUEST_LIMITS.MAX_PROVIDER_RESPONSE_BYTES
    )) {
        throw new ProxyError('INVALID_PROVIDER_RESPONSE');
    }
    try {
        return await readStreamText(response.body, REQUEST_LIMITS.MAX_PROVIDER_RESPONSE_BYTES);
    } catch (error) {
        if (error?.code === 'REQUEST_TOO_LARGE') {
            throw new ProxyError('INVALID_PROVIDER_RESPONSE');
        }
        throw error;
    }
}

async function applyRateLimit(env, bindingName, key) {
    const limiter = env?.[bindingName];
    if (!limiter || typeof limiter.limit !== 'function') {
        throw new ProxyError('INTERNAL_ERROR');
    }
    try {
        const result = await limiter.limit({ key });
        return result?.success === true;
    } catch {
        throw new ProxyError('INTERNAL_ERROR');
    }
}

async function applyInvalidRateLimit(env, request, origin, requestId, code) {
    try {
        const allowed = await applyRateLimit(
            env,
            RATE_LIMIT_BINDINGS.INVALID,
            `invalid:${sourceIpKey(request.headers.get('CF-Connecting-IP'))}`
        );
        return allowed
            ? failureResponse(code, requestId, origin)
            : failureResponse('RATE_LIMITED', requestId, origin);
    } catch (error) {
        return failureResponse(error?.code || 'INTERNAL_ERROR', requestId, origin);
    }
}

async function applyValidRateLimits(env, lane, session, request) {
    const sourceIp = sourceIpKey(request.headers.get('CF-Connecting-IP'));
    const [sessionAllowed, ipAllowed] = await Promise.all([
        applyRateLimit(env, RATE_LIMIT_BINDINGS.SESSION, `session:${lane}:${session}`),
        applyRateLimit(env, RATE_LIMIT_BINDINGS.IP, `ip:${lane}:${sourceIp}`)
    ]);
    return sessionAllowed && ipAllowed;
}

function isProviderSafetyBlock(responseBody, candidate) {
    return Boolean(responseBody?.promptFeedback?.blockReason)
        || Boolean(candidate?.safetyRatings?.some((rating) => rating?.blocked === true));
}

function extractProviderCandidateText(responseBody) {
    if (!responseBody || typeof responseBody !== 'object' || Array.isArray(responseBody)) {
        throw new ProxyError('INVALID_PROVIDER_RESPONSE');
    }
    const candidate = responseBody.candidates?.[0];
    if (isProviderSafetyBlock(responseBody, candidate)) {
        throw new ProxyError('PROVIDER_SAFETY_BLOCK');
    }
    if (!candidate || typeof candidate !== 'object') {
        throw new ProxyError('INVALID_PROVIDER_RESPONSE');
    }
    const finishReason = String(candidate.finishReason || '');
    if (SAFETY_FINISH_REASONS.has(finishReason)) {
        throw new ProxyError('PROVIDER_SAFETY_BLOCK');
    }
    if (!ACCEPTED_FINISH_REASONS.has(finishReason) || !Array.isArray(candidate.content?.parts)) {
        throw new ProxyError('INVALID_PROVIDER_RESPONSE');
    }
    const text = candidate.content.parts
        .map((part) => typeof part?.text === 'string' ? part.text : '')
        .join('')
        .trim();
    if (!text || byteLength(text) > REQUEST_LIMITS.MAX_MODEL_TEXT_BYTES) {
        throw new ProxyError('INVALID_PROVIDER_RESPONSE');
    }
    return text;
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId = null;
    const providerPromise = Promise.resolve().then(async () => {
        const response = await fetchImpl(url, {
            ...options,
            signal: controller.signal
        });
        if (!response?.ok) {
            return { response, source: null };
        }
        return { response, source: await readProviderText(response) };
    });
    // A provider implementation can reject after timeout/abort. Keep that late
    // rejection observed even though the request already has a safe response.
    void providerPromise.catch(() => {});
    const timeoutPromise = new Promise((_resolve, reject) => {
        timeoutId = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new ProxyError('UPSTREAM_TIMEOUT'));
        }, timeoutMs);
    });
    try {
        return await Promise.race([providerPromise, timeoutPromise]);
    } catch (error) {
        if (timedOut || error?.name === 'AbortError') {
            throw new ProxyError('UPSTREAM_TIMEOUT');
        }
        if (error instanceof ProxyError) {
            throw error;
        }
        throw new ProxyError('UPSTREAM_UNAVAILABLE');
    } finally {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
    }
}

async function callGemini(fetchImpl, env, lane, requestBody, timeoutMs) {
    const apiKey = typeof env?.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
    if (!apiKey) {
        throw new ProxyError('INTERNAL_ERROR');
    }
    const model = MODEL_BY_LANE[lane];
    if (!model) {
        throw new ProxyError('INTERNAL_ERROR');
    }
    const url = `${GEMINI_GENERATE_CONTENT_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
    let providerResult;
    try {
        providerResult = await fetchWithTimeout(fetchImpl, url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify(requestBody)
        }, timeoutMs);
    } catch (error) {
        if (error instanceof ProxyError) {
            throw error;
        }
        throw new ProxyError('UPSTREAM_UNAVAILABLE');
    }
    if (!providerResult.response?.ok) {
        throw new ProxyError(providerResult.response?.status >= 500
            ? 'UPSTREAM_UNAVAILABLE'
            : 'UPSTREAM_REJECTED');
    }
    let responseBody;
    try {
        responseBody = JSON.parse(providerResult.source);
    } catch {
        throw new ProxyError('INVALID_PROVIDER_RESPONSE');
    }
    return extractProviderCandidateText(responseBody);
}

function validateModelText(contract, lane, responseText, context) {
    try {
        const strictJsonText = contract.extractStrictJsonText(responseText);
        if (lane === 'chat') {
            contract.parseChatResponse(strictJsonText, context);
        } else {
            contract.parseIntentResponse(strictJsonText, context.viewerIds);
        }
        return strictJsonText;
    } catch {
        throw new ProxyError('INVALID_PROVIDER_RESPONSE');
    }
}

async function handleProxyRequest(request, env, origin, fetchImpl, timeoutMs) {
    if (request.method === 'OPTIONS') {
        if (origin !== AERO_LIVE_PROXY_ORIGIN) {
            return applyInvalidRateLimit(env, request, origin, null, 'INVALID_ORIGIN');
        }
        const requestedMethod = request.headers.get('Access-Control-Request-Method');
        if (requestedMethod && requestedMethod !== 'POST') {
            return applyInvalidRateLimit(env, request, origin, null, 'INVALID_METHOD');
        }
        return new Response(null, {
            status: 204,
            headers: responseHeaders(origin)
        });
    }
    if (request.method !== 'POST') {
        return applyInvalidRateLimit(env, request, origin, null, 'INVALID_METHOD');
    }
    if (origin !== AERO_LIVE_PROXY_ORIGIN) {
        return applyInvalidRateLimit(env, request, origin, null, 'INVALID_ORIGIN');
    }
    if (!isJsonContentType(request.headers.get('content-type'))) {
        return applyInvalidRateLimit(env, request, origin, null, 'INVALID_CONTENT_TYPE');
    }

    let parsed;
    let requestId = null;
    try {
        parsed = await readRequestJson(request);
        requestId = getSafeRequestId(parsed?.requestId);
    } catch (error) {
        return applyInvalidRateLimit(env, request, origin, requestId, error?.code || 'INVALID_JSON');
    }

    let envelope;
    let session;
    try {
        envelope = parseAndSanitizeEnvelope(parsed, AERO_LIVE_PROXY_VERSION);
        requestId = envelope.requestId;
        session = parseGameSession(request.headers.get('X-Game-Session'));
    } catch (error) {
        const code = error instanceof RequestValidationError ? error.code : 'INVALID_CONTEXT';
        return applyInvalidRateLimit(env, request, origin, requestId, code);
    }

    try {
        if (!await applyValidRateLimits(env, envelope.lane, session, request)) {
            return failureResponse('RATE_LIMITED', requestId, origin);
        }
        const contract = new AeroLiveLlmContract(SERVER_AI_RULES);
        const requestBody = envelope.lane === 'chat'
            ? contract.buildChatRequestBody(envelope.context)
            : contract.buildIntentRequestBody(envelope.context);
        const responseText = await callGemini(
            fetchImpl,
            env,
            envelope.lane,
            requestBody,
            timeoutMs
        );
        const text = validateModelText(contract, envelope.lane, responseText, envelope.context);
        return jsonResponse({
            ok: true,
            version: AERO_LIVE_PROXY_VERSION,
            requestId,
            lane: envelope.lane,
            text
        }, 200, origin);
    } catch (error) {
        const code = error instanceof ProxyError
            ? error.code
            : 'INVALID_CONTEXT';
        return failureResponse(code, requestId, origin);
    }
}

export function createAeroLiveWorker(options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis);
    const timeoutMs = Math.max(100, Number(options.timeoutMs) || REQUEST_LIMITS.REQUEST_TIMEOUT_MS);
    return {
        async fetch(request, env) {
            const url = new URL(request.url);
            const origin = request.headers.get('origin');
            if (url.pathname === '/health' && request.method === 'GET') {
                return jsonResponse({
                    ok: true,
                    service: 'aero-live-api',
                    version: AERO_LIVE_PROXY_VERSION
                }, 200, origin);
            }
            if (url.pathname !== AERO_LIVE_PROXY_PATH) {
                return failureResponse('NOT_FOUND', null, origin);
            }
            if (typeof fetchImpl !== 'function') {
                return failureResponse('INTERNAL_ERROR', null, origin);
            }
            return handleProxyRequest(request, env, origin, fetchImpl, timeoutMs);
        }
    };
}

export default createAeroLiveWorker();
