/**
 * AERO LIVE 프로토타입에서 사용하는 렌더, 입력, AI 연결 상수입니다.
 */
export const AERO_LIVE_SCENE_CONSTANTS = Object.freeze({
    ASSET: Object.freeze({
        HERO_FALLBACK_EXPRESSION: 'default',
        HERO_EXPRESSION_PATHS: Object.freeze({
            default: '../asset/image/chara/idle.gif',
            idle: '../asset/image/chara/idle.gif',
            neutral: '../asset/image/chara/idle.gif',
            smile: '../asset/image/chara/happy.png',
            laugh: '../asset/image/chara/happy.png',
            happy: '../asset/image/chara/happy.png',
            angry: '../asset/image/chara/angry.png',
            firm: '../asset/image/chara/angry.png',
            sad: '../asset/image/chara/sad.png',
            tired: '../asset/image/chara/sad.png',
            anxious: '../asset/image/chara/sad.png',
            shocked: '../asset/image/chara/shocked.png',
            surprised: '../asset/image/chara/shocked.png',
            embarrassed: '../asset/image/chara/embarrassed.png',
            flustered: '../asset/image/chara/embarrassed.png'
        })
    }),
    UI: Object.freeze({
        SAFE_MARGIN_UIWW: 1.4,
        PANEL_GAP_UIWW: 0.8,
        TOP_BAR_HEIGHT_WH: 8.2,
        BOTTOM_BAR_HEIGHT_WH: 15.5,
        LEFT_COLUMN_RATIO: 0.215,
        CENTER_COLUMN_RATIO: 0.49,
        RIGHT_COLUMN_RATIO: 0.275,
        PANEL_RADIUS_WH: 1.7,
        PANEL_PADDING_UIWW: 1.0,
        TOPIC_CARD_GAP_UIWW: 1.0,
        TOPIC_CARD_HEIGHT_WH: 24,
        CHAT_VISIBLE_COUNT: 9,
        CHAT_LINE_HEIGHT_WH: 4.7,
        HERO_DIALOGUE_HEIGHT_WH: 16,
        DOM_INPUT_HEIGHT_WH: 5.2,
        DOM_SEND_WIDTH_UIWW: 5.3,
        CORE_ACTION_HEIGHT_WH: 4.7,
        DONATION_ACTION_HEIGHT_WH: 4.8,
        STATUS_TOAST_SECONDS: 3.2,
        TITLE_FONT_WH: 4.6,
        SUBTITLE_FONT_WH: 2.0,
        BODY_FONT_WH: 1.72,
        SMALL_FONT_WH: 1.35,
        METRIC_FONT_WH: 1.55,
        DIALOGUE_FONT_WH: 2.0
    }),
    COLORS: Object.freeze({
        SKY_TOP: '#5FCBFF',
        SKY_BOTTOM: '#DDFBFF',
        AQUA: '#42E0D0',
        GREEN: '#62D65B',
        DEEP_BLUE: '#1769C7',
        GLASS_WHITE: '#F5FEFF',
        GLASS_FILL: 'rgba(245,254,255,0.76)',
        GLASS_FILL_STRONG: 'rgba(245,254,255,0.92)',
        GLASS_BORDER: 'rgba(255,255,255,0.94)',
        GLASS_SHADOW: 'rgba(23,105,199,0.18)',
        INK: '#0B2940',
        INK_MUTED: '#37657D',
        WARNING: '#FFD65A',
        NEGATIVE: '#FF6B78',
        POSITIVE: '#25B96E',
        NEUTRAL: '#4A8CCB',
        LIVE: '#FF4770',
        DARK_GLASS: 'rgba(11,41,64,0.88)',
        DARK_GLASS_SOFT: 'rgba(11,41,64,0.68)'
    }),
    AI: Object.freeze({
        ENABLED: true,
        API_MODEL: 'gemini-3.5-flash-lite',
        PROMPT_REVISION: 'aero-live-chat-v2',
        SCHEMA_VERSION: 'aero-live-ai-v1',
        REQUEST_TIMEOUT_MS: 8000,
        THINKING_LEVEL: 'low',
        CHAT_MAX_OUTPUT_TOKENS: 2048,
        INTENT_MAX_OUTPUT_TOKENS: 768,
        CHAT_BATCH_SIZE: 16,
        MAX_CACHE_ENTRIES: 48,
        GENERATION_SEED: 240729,
        PLAYER_MESSAGE_MAX_CHARS: 140,
        GENERATED_CHAT_MAX_CHARS: 64
    }),
    INPUT: Object.freeze({
        PLACEHOLDER: '시청자로 위장해 여론에 개입하세요',
        SEND_LABEL: '전송',
        MASK_LABEL: '가면 계정'
    }),
    INSTRUCTIONS: Object.freeze([
        Object.freeze({ id: 'positive', label: '긍정', shortLabel: '긍정' }),
        Object.freeze({ id: 'negative', label: '부정', shortLabel: '부정' }),
        Object.freeze({ id: 'ignore', label: '무시', shortLabel: '무시' }),
        Object.freeze({ id: 'redirect', label: '화제 전환', shortLabel: '전환' }),
        Object.freeze({ id: 'empathy', label: '공감', shortLabel: '공감' })
    ])
});
