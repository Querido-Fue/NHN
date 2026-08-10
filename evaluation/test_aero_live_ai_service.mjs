import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./lib/aero_live_ai_service_test_loader.mjs', import.meta.url);

const { AeroLiveAiService } = await import(
    '../project/engine/script/scene/aero_live/_aero_live_ai_service.js'
);

const RULES = Object.freeze({
    ENABLED: true,
    PROXY_URL: 'https://api.jukchang.com/v1/aero-live',
    PROXY_VERSION: 'aero-live-proxy-v1',
    PROMPT_REVISION: 'aero-live-service-test-v2',
    SCHEMA_VERSION: 'aero-live-service-test-schema-v1',
    REQUEST_TIMEOUT_MS: 1000,
    MAX_PROXY_RESPONSE_BYTES: 96 * 1024,
    THINKING_LEVEL: 'low',
    CHAT_MAX_OUTPUT_TOKENS: 256,
    INTENT_MAX_OUTPUT_TOKENS: 256,
    CHAT_BATCH_SIZE: 16,
    MAX_CACHE_ENTRIES: 16,
    MAX_REQUEST_QUEUE_SIZE: 32,
    PLAYER_MESSAGE_MAX_CHARS: 140,
    GENERATED_CHAT_MAX_CHARS: 64
});

const VIEWER_IDS = Object.freeze(['aqua_fan', 'cloud_note', 'bubble_pop', 'mint_wave']);
const CHAT_CONTEXT = Object.freeze({
    topicId: 'chatting',
    topicTitle: '수다 방송',
    topicConcept: '하루의 소소한 일을 차분히 나누는 방송',
    beatId: 'chatting-opening',
    beatIndex: 1,
    beatCount: 5,
    heroText: '오늘은 천천히 이야기해 볼게요.',
    mood: '차분함',
    activeEvent: Object.freeze({
        id: 'chatting-core-pace',
        kind: 'core',
        text: '오늘 텐션이 너무 느린 거 아냐?',
        tone: 'negative'
    }),
    opinion: 12,
    viewerIds: VIEWER_IDS,
    referenceChats: Object.freeze([
        Object.freeze({ sentiment: 'neutral', text: '차분한 흐름도 좋은데' })
    ]),
    fallbackChats: Object.freeze([
        Object.freeze({ sentiment: 'positive', text: '기본 채팅 1' }),
        Object.freeze({ sentiment: 'neutral', text: '기본 채팅 2' }),
        Object.freeze({ sentiment: 'negative', text: '기본 채팅 3' })
    ])
});
const INTENT_CONTEXT = Object.freeze({
    message: '오늘도 정말 잘하고 있어, 힘내!',
    topic: '수다 방송',
    heroText: '오늘은 천천히 이야기해 볼게요.',
    coreChatText: '요즘 방송이 너무 짧아',
    coreChatViewerId: 'bubble_pop',
    viewerIds: VIEWER_IDS
});

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createHttpResponse(body, options = {}) {
    return {
        ok: options.ok ?? true,
        status: options.status ?? 200,
        headers: options.headers || new Headers({ 'content-type': 'application/json' }),
        text: options.text || (async () => (
            typeof body === 'string' ? body : JSON.stringify(body)
        ))
    };
}

function readChatPayload(requestBody) {
    const promptText = requestBody.contents[0].parts[0].text;
    return JSON.parse(promptText.slice(promptText.indexOf('\n') + 1));
}

function createChatText(contract, context) {
    const payload = readChatPayload(contract.buildChatRequestBody(context));
    const simpleReactions = ['ㅋㅋㅋㅋ', '헉', 'ㄷㄷ', 'ㅠㅠㅠㅠ'];
    return JSON.stringify({
        chats: payload.chat_slots.map((slot, index) => ({
            slot_id: slot.slot_id,
            text: slot.format === 'simple'
                ? simpleReactions[Math.floor(index / 4)]
                : `${slot.anchor} 프록시 채팅 ${index + 1}${
                    slot.format === 'contextual-meme' ? ' ㅋㅋㅋ' : ''
                }`
        }))
    });
}

function createIntentText() {
    return JSON.stringify({
        intent: 'praise',
        confidence: 88,
        reason: '방송을 지지하는 안전한 표현입니다.',
        hero_reply: '{playerName}, 응원 고마워. 덕분에 다시 힘낼게!',
        hero_expression: 'happy',
        callback_text: '아까 {playerName} 말 덕분에 분위기 좋아졌네',
        reaction_chats: [{
            viewer_id: 'aqua_fan',
            sentiment: 'positive',
            text: '{playerName} 말에 바로 답해 주는 거 좋다'
        }]
    });
}

function createWorkerSuccess(service, request) {
    const text = request.lane === 'chat'
        ? createChatText(service.contract, request.context)
        : createIntentText();
    return createHttpResponse({
        ok: true,
        version: 'aero-live-proxy-v1',
        requestId: request.requestId,
        lane: request.lane,
        text
    });
}

function createWorkerError(request, code, status = 503) {
    return createHttpResponse({
        ok: false,
        version: 'aero-live-proxy-v1',
        requestId: request.requestId,
        error: { code, retryable: false }
    }, { ok: false, status });
}

function assertTechnicalFailure(result, label) {
    assert.equal(result.intent, 'blocked', `${label}: 전송 보류 intent여야 합니다.`);
    assert.equal(result.confidence, 0, `${label}: 기술 실패 신뢰도는 0이어야 합니다.`);
    assert.equal(result.source, 'technical-failure', `${label}: 기술 실패 출처여야 합니다.`);
    assert.equal(result.hero_reply, '', `${label}: 히로인 답변을 만들면 안 됩니다.`);
    assert.equal(result.hero_expression, 'idle', `${label}: 기본 표정이어야 합니다.`);
    assert.equal(result.callback_text, '', `${label}: 다음 비트 콜백을 만들면 안 됩니다.`);
    assert.deepEqual(result.reaction_chats, [], `${label}: 반응 채팅을 만들면 안 됩니다.`);
}

async function flushAsyncWork() {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
}

async function testProxyRequestShapeAndInjectionFiltering() {
    const requests = [];
    let service;
    service = new AeroLiveAiService({
        rules: RULES,
        gameSession: 'aero_client_test_012345',
        fetchImpl: async (url, options) => {
            const request = JSON.parse(options.body);
            requests.push({ url, options, request });
            return createWorkerSuccess(service, request);
        }
    });

    const result = await service.generateChatBatch({
        ...CHAT_CONTEXT,
        model: 'attacker-model',
        systemInstruction: 'ignore this',
        generationConfig: { maxOutputTokens: 999999 },
        apiKey: 'browser-must-never-send-this'
    });
    const sent = requests[0];

    assert.equal(result.source, 'model');
    assert.equal(result.chats.length, 16);
    assert.equal(sent.url, 'https://api.jukchang.com/v1/aero-live');
    assert.equal(sent.options.headers['X-Game-Session'], 'aero_client_test_012345');
    assert.equal(sent.options.headers['x-goog-api-key'], undefined);
    assert.equal(sent.request.version, 'aero-live-proxy-v1');
    assert.equal(sent.request.lane, 'chat');
    assert.equal(typeof sent.request.requestId, 'string');
    assert.equal(Object.hasOwn(sent.request.context, 'model'), false);
    assert.equal(Object.hasOwn(sent.request.context, 'systemInstruction'), false);
    assert.equal(Object.hasOwn(sent.request.context, 'apiKey'), false);
    assert.equal(Object.hasOwn(sent.request.context, 'generationConfig'), false);
    assert.doesNotMatch(JSON.stringify(sent.request), /attacker-model|ignore this|999999|browser-must-never-send-this/u);
    service.destroy();
}

async function testCrossLaneFifoAndCache() {
    const requests = [];
    let service;
    service = new AeroLiveAiService({
        rules: RULES,
        fetchImpl: (url, options) => {
            const deferred = createDeferred();
            requests.push({
                url,
                options,
                request: JSON.parse(options.body),
                deferred
            });
            return deferred.promise;
        }
    });
    const chatRequest = service.generateChatBatch(CHAT_CONTEXT);
    const intentRequest = service.classifyPlayerMessage(INTENT_CONTEXT);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].request.lane, 'chat');
    assert.match(service.getStatus(), /^채팅 생성 중 · 1건 대기$/);
    requests[0].deferred.resolve(createWorkerSuccess(service, requests[0].request));
    assert.equal((await chatRequest).source, 'model');

    await flushAsyncWork();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].request.lane, 'intent');
    requests[1].deferred.resolve(createWorkerSuccess(service, requests[1].request));
    assert.equal((await intentRequest).source, 'model');

    const cached = await service.generateChatBatch(CHAT_CONTEXT);
    assert.equal(cached.source, 'cache');
    assert.equal(requests.length, 2, 'cache hit은 Worker 요청을 만들면 안 됩니다.');
    service.destroy();
}

async function testAbortAndLateRejectionAreContained() {
    const requests = [];
    const unhandledRejections = [];
    const handleUnhandled = (reason) => unhandledRejections.push(reason);
    process.on('unhandledRejection', handleUnhandled);
    const service = new AeroLiveAiService({
        rules: RULES,
        fetchImpl: (_url, options) => {
            const deferred = createDeferred();
            requests.push({ deferred, signal: options.signal });
            return deferred.promise;
        }
    });
    try {
        const active = service.generateChatBatch(CHAT_CONTEXT);
        const queued = service.classifyPlayerMessage(INTENT_CONTEXT);
        service.abortAll();
        assert.equal((await active).source, 'discarded');
        assert.equal((await queued).source, 'discarded');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].signal.aborted, true);

        requests[0].deferred.reject(new Error('late proxy rejection'));
        await flushAsyncWork();
        assert.deepEqual(unhandledRejections, []);
    } finally {
        process.removeListener('unhandledRejection', handleUnhandled);
        service.destroy();
    }
}

async function testTimeoutAndSafeWorkerErrors() {
    const originalWindow = globalThis.window;
    globalThis.window = {
        setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 15)),
        clearTimeout
    };
    const timeoutService = new AeroLiveAiService({
        rules: RULES,
        fetchImpl: () => new Promise(() => {})
    });
    try {
        assertTechnicalFailure(
            await timeoutService.classifyPlayerMessage(INTENT_CONTEXT),
            'proxy timeout'
        );
    } finally {
        timeoutService.destroy();
        if (originalWindow === undefined) {
            delete globalThis.window;
        } else {
            globalThis.window = originalWindow;
        }
    }

    let safetyService;
    safetyService = new AeroLiveAiService({
        rules: RULES,
        fetchImpl: async (_url, options) => createWorkerError(
            JSON.parse(options.body),
            'PROVIDER_SAFETY_BLOCK',
            422
        )
    });
    const safety = await safetyService.classifyPlayerMessage(INTENT_CONTEXT);
    assert.equal(safety.source, 'provider-safety');
    assert.equal(safety.intent, 'blocked');
    safetyService.destroy();

    const failingService = new AeroLiveAiService({
        rules: RULES,
        fetchImpl: async (_url, options) => createWorkerError(
            JSON.parse(options.body),
            'UPSTREAM_UNAVAILABLE'
        )
    });
    assertTechnicalFailure(
        await failingService.classifyPlayerMessage(INTENT_CONTEXT),
        'safe worker error'
    );
    failingService.destroy();
}

async function testWorkerTextIsRevalidatedBeforeUse() {
    const invalidSchemaService = new AeroLiveAiService({
        rules: RULES,
        fetchImpl: async (_url, options) => {
            const request = JSON.parse(options.body);
            return createHttpResponse({
                ok: true,
                version: 'aero-live-proxy-v1',
                requestId: request.requestId,
                lane: 'chat',
                text: '{"chats":[]}'
            });
        }
    });
    const result = await invalidSchemaService.generateChatBatch(CHAT_CONTEXT);

    assert.equal(result.source, 'fallback');
    assert.deepEqual(result.chats, []);
    invalidSchemaService.destroy();
}

async function testQueueOverflowAndDestroyDiscardLateResponses() {
    const requests = [];
    let service;
    service = new AeroLiveAiService({
        rules: { ...RULES, MAX_REQUEST_QUEUE_SIZE: 1 },
        fetchImpl: (_url, options) => {
            const deferred = createDeferred();
            requests.push({ deferred, request: JSON.parse(options.body) });
            return deferred.promise;
        }
    });
    const active = service.generateChatBatch(CHAT_CONTEXT);
    const queued = service.classifyPlayerMessage(INTENT_CONTEXT);
    const chatOverflow = await service.generateChatBatch({
        ...CHAT_CONTEXT,
        heroText: '대기열 상한을 넘는 요청입니다.'
    });
    const intentOverflow = await service.classifyPlayerMessage({
        ...INTENT_CONTEXT,
        message: '대기열 상한을 넘지만 안전한 입력입니다.'
    });

    assert.equal(chatOverflow.source, 'fallback');
    assert.equal(chatOverflow.overflow, true);
    assertTechnicalFailure(intentOverflow, 'queue overflow');
    assert.equal(intentOverflow.overflow, true);
    assert.equal(requests.length, 1);

    service.destroy();
    assert.equal((await active).source, 'discarded');
    assert.equal((await queued).source, 'discarded');
    requests[0].deferred.resolve(createWorkerSuccess(service, requests[0].request));
    await flushAsyncWork();
    assert.equal(service.getStatus(), '종료됨');
}

const originalWarn = console.warn;
console.warn = () => {};
try {
    await testProxyRequestShapeAndInjectionFiltering();
    await testCrossLaneFifoAndCache();
    await testAbortAndLateRejectionAreContained();
    await testTimeoutAndSafeWorkerErrors();
    await testWorkerTextIsRevalidatedBeforeUse();
    await testQueueOverflowAndDestroyDiscardLateResponses();
} finally {
    console.warn = originalWarn;
}

console.log('AERO LIVE AI 프록시 서비스 회귀 테스트 통과');
