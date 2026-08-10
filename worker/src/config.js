import { AERO_LIVE_SCENE_CONSTANTS } from '../../project/engine/script/data/scene/aero_live/aero_live_scene_constants.js';

export const AERO_LIVE_PROXY_VERSION = 'aero-live-proxy-v1';
export const AERO_LIVE_PROXY_PATH = '/v1/aero-live';
export const AERO_LIVE_PROXY_ORIGIN = 'https://querido-fue.github.io';
export const GEMINI_GENERATE_CONTENT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export const REQUEST_LIMITS = Object.freeze({
    MAX_BODY_BYTES: 24 * 1024,
    MAX_PROVIDER_RESPONSE_BYTES: 96 * 1024,
    MAX_MODEL_TEXT_BYTES: 24 * 1024,
    MAX_CONTEXT_DEPTH: 5,
    MAX_CONTEXT_STRING_CHARS: 240,
    REQUEST_TIMEOUT_MS: 8_000
});

// The game constants are the source of truth for the existing output-contract
// settings. The fixed lane models below are server-only; no request field can
// replace either value.
export const SERVER_AI_RULES = Object.freeze({
    ...AERO_LIVE_SCENE_CONSTANTS.AI,
    ENABLED: true
});

export const MODEL_BY_LANE = Object.freeze({
    chat: 'gemini-3.6-flash',
    intent: 'gemini-3.5-flash-lite'
});

export const RATE_LIMIT_BINDINGS = Object.freeze({
    SESSION: 'AERO_LIVE_SESSION_LIMITER',
    IP: 'AERO_LIVE_IP_LIMITER',
    INVALID: 'AERO_LIVE_INVALID_LIMITER'
});
