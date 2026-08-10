import assert from 'node:assert/strict';
import { AeroLiveApiClient } from '../project/engine/script/scene/aero_live/_aero_live_api_client.js';

const PROXY_URL = 'https://api.jukchang.com/v1/aero-live';
const PROXY_VERSION = 'aero-live-proxy-v1';
const SESSION = 'aero_client_test_session_012345';

function createResponse(body, options = {}) {
    return {
        ok: options.ok ?? true,
        status: options.status ?? 200,
        headers: new Headers({
            'content-type': options.contentType ?? 'application/json'
        }),
        text: options.text || (async () => (
            typeof body === 'string' ? body : JSON.stringify(body)
        ))
    };
}

function createClient(fetchImpl, options = {}) {
    return new AeroLiveApiClient({
        proxyUrl: PROXY_URL,
        proxyVersion: PROXY_VERSION,
        timeoutMs: options.timeoutMs ?? 1000,
        maxResponseBytes: options.maxResponseBytes ?? (96 * 1024),
        fetchImpl,
        sessionId: SESSION
    });
}

function successEnvelope(request, lane = request.lane, text = '{"ok":true}') {
    return {
        ok: true,
        version: PROXY_VERSION,
        requestId: request.requestId,
        lane,
        text
    };
}

function failureEnvelope(request, code) {
    return {
        ok: false,
        version: PROXY_VERSION,
        requestId: request.requestId,
        error: { code, retryable: false }
    };
}

async function expectCode(promise, code) {
    await assert.rejects(promise, new RegExp(`^Error: ${code}$`, 'u'));
}

async function testSuccessRequestShape() {
    const calls = [];
    const client = createClient(async (url, options) => {
        const request = JSON.parse(options.body);
        calls.push({ url, options, request });
        return createResponse(successEnvelope(request));
    });

    const text = await client.request('chat', {
        topicTitle: '수다 방송',
        viewerIds: ['aqua_fan']
    });
    const call = calls[0];

    assert.equal(text, '{"ok":true}');
    assert.equal(call.url, PROXY_URL);
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.headers['Content-Type'], 'application/json');
    assert.equal(call.options.headers['X-Game-Session'], SESSION);
    assert.equal(call.request.version, PROXY_VERSION);
    assert.equal(call.request.lane, 'chat');
    assert.match(call.request.requestId, /^aero_client_test_session_012345_r1$/u);
    client.destroy();
}

async function testSafeHttpErrors() {
    for (const [status, code] of [
        [400, 'INVALID_CONTEXT'],
        [403, 'INVALID_ORIGIN'],
        [429, 'RATE_LIMITED'],
        [500, 'INTERNAL_ERROR']
    ]) {
        const client = createClient(async (_url, options) => {
            const request = JSON.parse(options.body);
            return createResponse(failureEnvelope(request, code), { ok: false, status });
        });
        await expectCode(client.request('intent', {}), `PROXY_${code}`);
        client.destroy();
    }
}

async function testResponseEnvelopeValidation() {
    const cases = [
        {
            label: 'wrong version',
            response: (request) => ({ ...successEnvelope(request), version: 'wrong' })
        },
        {
            label: 'request id mismatch',
            response: (request) => ({ ...successEnvelope(request), requestId: 'other_request_0001' })
        },
        {
            label: 'lane mismatch',
            response: (request) => successEnvelope(request, 'intent')
        },
        {
            label: 'missing text',
            response: (request) => {
                const response = successEnvelope(request);
                delete response.text;
                return response;
            }
        }
    ];
    for (const testCase of cases) {
        const client = createClient(async (_url, options) => {
            const request = JSON.parse(options.body);
            return createResponse(testCase.response(request));
        });
        await expectCode(client.request('chat', {}), 'PROXY_INVALID_RESPONSE');
        client.destroy();
    }
}

async function testMalformedAndInvalidContentResponses() {
    const malformed = createClient(async () => createResponse('not-json'));
    await expectCode(malformed.request('chat', {}), 'PROXY_INVALID_JSON');
    malformed.destroy();

    const wrongType = createClient(async (_url, options) => createResponse(
        successEnvelope(JSON.parse(options.body)),
        { contentType: 'text/plain' }
    ));
    await expectCode(wrongType.request('chat', {}), 'PROXY_INVALID_CONTENT_TYPE');
    wrongType.destroy();

    const oversized = createClient(
        async () => createResponse('x'.repeat(2048)),
        { maxResponseBytes: 1024 }
    );
    await expectCode(oversized.request('chat', {}), 'PROXY_RESPONSE_TOO_LARGE');
    oversized.destroy();
}

async function testAbortAndTimeout() {
    const deferred = {};
    deferred.promise = new Promise((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
    });
    const abortClient = createClient(async (_url, options) => {
        options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            deferred.reject(error);
        }, { once: true });
        return deferred.promise;
    });
    const request = abortClient.request('chat', {});
    abortClient.abortAll();
    await assert.rejects(request, /REQUEST_ABORTED|AbortError/u);
    abortClient.destroy();

    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: (callback) => setTimeout(callback, 10),
        clearTimeout
    };
    const timeoutClient = createClient(() => new Promise(() => {}));
    try {
        await expectCode(timeoutClient.request('chat', {}), 'REQUEST_TIMEOUT');
    } finally {
        timeoutClient.destroy();
        if (originalWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }
    }
}

await testSuccessRequestShape();
await testSafeHttpErrors();
await testResponseEnvelopeValidation();
await testMalformedAndInvalidContentResponses();
await testAbortAndTimeout();

console.log('AERO LIVE Worker API client regression tests passed');
