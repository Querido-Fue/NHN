import { REQUEST_LIMITS } from './config.js';

const PROTOTYPE_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,95}$/u;
const SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/u;
const SENTIMENTS = new Set(['positive', 'negative', 'neutral']);

export class RequestValidationError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function codePointLength(value) {
    return Array.from(value).length;
}

function assertContextTree(value, depth = 0) {
    if (depth > REQUEST_LIMITS.MAX_CONTEXT_DEPTH) {
        throw new RequestValidationError('INVALID_CONTEXT');
    }
    if (typeof value === 'string') {
        if (codePointLength(value) > REQUEST_LIMITS.MAX_CONTEXT_STRING_CHARS) {
            throw new RequestValidationError('INVALID_CONTEXT');
        }
        return;
    }
    if (!value || typeof value !== 'object') {
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            assertContextTree(item, depth + 1);
        }
        return;
    }
    for (const key of Object.keys(value)) {
        if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
            throw new RequestValidationError('INVALID_CONTEXT');
        }
        assertContextTree(value[key], depth + 1);
    }
}

function optionalString(source, key, maxChars, fallback = '') {
    if (!hasOwn(source, key) || source[key] === null || source[key] === undefined) {
        return fallback;
    }
    if (typeof source[key] !== 'string' || codePointLength(source[key]) > maxChars) {
        throw new RequestValidationError('INVALID_CONTEXT');
    }
    return source[key];
}

function optionalInteger(source, key, min, max, fallback = 0) {
    if (!hasOwn(source, key) || source[key] === null || source[key] === undefined) {
        return fallback;
    }
    const value = source[key];
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RequestValidationError('INVALID_CONTEXT');
    }
    return value;
}

function optionalNumber(source, key, min, max, fallback = 0) {
    if (!hasOwn(source, key) || source[key] === null || source[key] === undefined) {
        return fallback;
    }
    const value = source[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw new RequestValidationError('INVALID_CONTEXT');
    }
    return value;
}

function sanitizeViewerIds(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
        throw new RequestValidationError('INVALID_CONTEXT');
    }
    const viewerIds = [];
    const seen = new Set();
    for (const item of value) {
        if (typeof item !== 'string' || !item || codePointLength(item) > 24) {
            throw new RequestValidationError('INVALID_CONTEXT');
        }
        const normalized = item.normalize('NFKC').trim();
        if (!normalized || seen.has(normalized)) {
            throw new RequestValidationError('INVALID_CONTEXT');
        }
        seen.add(normalized);
        viewerIds.push(normalized);
    }
    return viewerIds;
}

function sanitizeChatItems(value, maxItems, includeViewerId) {
    if (!Array.isArray(value) || value.length > maxItems) {
        throw new RequestValidationError('INVALID_CONTEXT');
    }
    return value.map((item) => {
        if (!isRecord(item)) {
            throw new RequestValidationError('INVALID_CONTEXT');
        }
        const text = optionalString(item, 'text', 180);
        const sentiment = optionalString(item, 'sentiment', 24, 'neutral');
        if (!SENTIMENTS.has(sentiment)) {
            throw new RequestValidationError('INVALID_CONTEXT');
        }
        const safeItem = { sentiment, text };
        if (includeViewerId) {
            safeItem.viewerId = optionalString(item, 'viewerId', 24);
        }
        return safeItem;
    });
}

function sanitizeActiveEvent(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (!isRecord(value)) {
        throw new RequestValidationError('INVALID_CONTEXT');
    }
    return {
        id: optionalString(value, 'id', 80),
        kind: optionalString(value, 'kind', 24),
        text: optionalString(value, 'text', 180),
        tone: optionalString(value, 'tone', 24)
    };
}

function sanitizeChatContext(context) {
    return {
        topicId: optionalString(context, 'topicId', 40),
        topicTitle: optionalString(context, 'topicTitle', 80),
        topicConcept: optionalString(context, 'topicConcept', 180),
        beatId: optionalString(context, 'beatId', 80),
        beatIndex: optionalInteger(context, 'beatIndex', 0, 999),
        beatCount: optionalInteger(context, 'beatCount', 0, 999),
        heroText: optionalString(context, 'heroText', 240),
        mood: optionalString(context, 'mood', 40),
        activeEvent: sanitizeActiveEvent(context.activeEvent),
        opinion: optionalNumber(context, 'opinion', -100, 100),
        referenceChats: sanitizeChatItems(context.referenceChats ?? [], 12, false),
        fallbackChats: sanitizeChatItems(context.fallbackChats ?? [], 16, true),
        viewerIds: sanitizeViewerIds(context.viewerIds)
    };
}

function sanitizeIntentContext(context) {
    const message = optionalString(context, 'message', 140);
    if (!message) {
        throw new RequestValidationError('INVALID_CONTEXT');
    }
    return {
        message,
        topic: optionalString(context, 'topic', 40),
        heroText: optionalString(context, 'heroText', 240),
        coreChatText: optionalString(context, 'coreChatText', 140),
        coreChatViewerId: optionalString(context, 'coreChatViewerId', 24),
        viewerIds: sanitizeViewerIds(context.viewerIds)
    };
}

export function parseAndSanitizeEnvelope(value, expectedVersion) {
    if (!isRecord(value)) {
        throw new RequestValidationError('INVALID_JSON');
    }
    const requestId = typeof value.requestId === 'string' ? value.requestId : '';
    if (value.version !== expectedVersion) {
        throw new RequestValidationError('INVALID_VERSION');
    }
    if (value.lane !== 'chat' && value.lane !== 'intent') {
        throw new RequestValidationError('INVALID_LANE');
    }
    if (!REQUEST_ID_PATTERN.test(requestId)) {
        throw new RequestValidationError('INVALID_REQUEST_ID');
    }
    if (!isRecord(value.context)) {
        throw new RequestValidationError('INVALID_CONTEXT');
    }
    assertContextTree(value.context);
    return {
        requestId,
        lane: value.lane,
        context: value.lane === 'chat'
            ? sanitizeChatContext(value.context)
            : sanitizeIntentContext(value.context)
    };
}

export function parseGameSession(value) {
    if (typeof value !== 'string' || !SESSION_PATTERN.test(value)) {
        throw new RequestValidationError('INVALID_SESSION');
    }
    return value;
}

export function getSafeRequestId(value) {
    return typeof value === 'string' && REQUEST_ID_PATTERN.test(value) ? value : null;
}

export function isJsonContentType(value) {
    return typeof value === 'string'
        && value.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

export function sourceIpKey(value) {
    return typeof value === 'string' && /^[0-9A-Fa-f:.]{1,64}$/u.test(value)
        ? value
        : 'unknown';
}
