import { getData } from 'data/data_handler.js';
import { getDisplaySystem, measureText, render } from 'display/display_system.js';
import { OverlaySession } from 'overlay/_overlay_session.js';
import { getSetting } from 'save/save_system.js';
import { createFontString, truncateTextToWidth, wrapTextByCharacters } from 'util/font_util.js';
import { buildVisibleChatRows } from './_aero_live_chat_layout.mjs';
import { resolveAeroLivePlayerNameTemplate } from './_aero_live_player_identity.mjs';

const AERO_CONSTANTS = getData('AERO_LIVE_SCENE_CONSTANTS');
const UI = AERO_CONSTANTS.UI;
const COLORS = AERO_CONSTANTS.COLORS;
const HERO_EXPRESSION_PATHS = AERO_CONSTANTS.ASSET.HERO_EXPRESSION_PATHS || {};
const HERO_FALLBACK_EXPRESSION = AERO_CONSTANTS.ASSET.HERO_FALLBACK_EXPRESSION || 'default';
const FONT_FAMILY = 'Pretendard Variable, arial';
const TOPIC_ACCENTS = Object.freeze(['#42E0D0', '#62D65B', '#FFD65A', '#FF8AA1', '#7B9CFF']);
const CORE_COLORS = Object.freeze({
    kick: COLORS.NEGATIVE,
    delete: COLORS.WARNING,
    ignore: COLORS.NEUTRAL
});
const GLASS_STYLE = Object.freeze({
    BLUR: 16,
    TINT_STRENGTH: 0.2,
    EDGE_STRENGTH: 0.5,
    REFRACTION_STRENGTH: 0.012,
    SHADOW_RADIUS: 18,
    SHADOW_OFFSET_Y: 7
});
const EXPRESSION_LABELS = Object.freeze({
    default: '기본', idle: '기본', neutral: '평온',
    smile: '미소', laugh: '웃음', happy: '기쁨',
    angry: '화남', firm: '단호', anxious: '불안',
    embarrassed: '당황', flustered: '당황', sad: '슬픔',
    tired: '피곤', shocked: '놀람', surprised: '놀람'
});
const MOOD_LABELS = Object.freeze({
    analytical: '분석적', bright: '명랑', calm: '차분', careful: '신중',
    excited: '들뜸', flustered: '당황', focused: '집중', hesitant: '망설임',
    moved: '감동', playful: '장난기', relieved: '안도', resolved: '결연',
    satisfied: '만족', tense: '긴장', thoughtful: '사색',
    'tired-warm': '포근한 피로', warm: '따뜻함'
});

/**
 * 숫자를 지정한 범위로 제한합니다.
 * @param {*} value - 원본 값입니다.
 * @param {number} minimum - 최솟값입니다.
 * @param {number} maximum - 최댓값입니다.
 * @returns {number} 제한된 값입니다.
 */
function clamp(value, minimum, maximum) {
    const numeric = Number(value);
    return Math.min(maximum, Math.max(minimum, Number.isFinite(numeric) ? numeric : minimum));
}

/**
 * 알 수 없는 값을 유한한 숫자로 바꿉니다.
 * @param {*} value - 원본 값입니다.
 * @param {number} [fallback=0] - 기본값입니다.
 * @returns {number} 유한한 숫자입니다.
 */
function number(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * 화면 출력 문자열에서 제어문자와 과도한 공백을 제거합니다.
 * @param {*} value - 원본 값입니다.
 * @param {number} [maxChars=240] - 최대 코드포인트 수입니다.
 * @returns {string} 안전한 한 줄 문자열입니다.
 */
function text(value, maxChars = 240) {
    return Array.from(String(value ?? '')
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim())
        .slice(0, maxChars)
        .join('');
}

/**
 * 정수를 한국어 천 단위 문자열로 표시합니다.
 * @param {*} value - 표시할 값입니다.
 * @returns {string} 정수 문자열입니다.
 */
function integer(value) {
    return Math.round(number(value)).toLocaleString('ko-KR');
}

/**
 * 초를 분:초 문자열로 표시합니다.
 * @param {*} seconds - 초 단위 값입니다.
 * @returns {string} 분:초 문자열입니다.
 */
function clock(seconds) {
    const total = Math.max(0, Math.floor(number(seconds)));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 결과 변화량을 부호가 포함된 정수 문자열로 표시합니다.
 * @param {*} value - 변화량입니다.
 * @returns {string} + 또는 - 부호가 포함된 문자열입니다.
 */
function delta(value) {
    const numeric = Math.round(number(value));
    return `${numeric > 0 ? '+' : ''}${numeric}`;
}

/**
 * AERO LIVE의 Canvas 표현과 텍스트 레이아웃을 전담합니다.
 */
export class AeroLiveRenderer {
    /**
     * 히로인 표정 이미지를 경로별로 한 번씩 미리 불러옵니다.
     */
    constructor() {
        this.destroyed = false;
        this.glassSession = null;
        this.glassSessionInitialized = false;
        this.lastBlurTimeBucket = -1;
        this.contentLayer = 'ui';
        this.heroReady = false;
        this.heroFailed = false;
        this.heroAssets = new Map();
        this.heroAssetRecords = [];
        const recordsByPath = new Map();
        const pendingLoads = [];

        for (const [rawExpression, rawPath] of Object.entries(HERO_EXPRESSION_PATHS)) {
            const expression = String(rawExpression || '').trim().toLowerCase();
            const path = String(rawPath || '').trim();
            if (!expression || !path) continue;

            let record = recordsByPath.get(path);
            if (!record) {
                const image = new Image();
                record = {
                    path,
                    image,
                    ready: false,
                    failed: false,
                    expressions: []
                };
                recordsByPath.set(path, record);
                this.heroAssetRecords.push(record);
                pendingLoads.push(new Promise((resolve) => {
                    const settle = (ready) => {
                        if (record.ready || record.failed) return;
                        record.ready = ready;
                        record.failed = !ready;
                        resolve();
                    };
                    image.onload = () => settle(true);
                    image.onerror = () => settle(false);
                }));
                image.src = path;
            }
            record.expressions.push(expression);
            this.heroAssets.set(expression, record);
        }

        this.readyPromise = Promise.all(pendingLoads).then(() => {
            if (!this.destroyed) this.#refreshHeroLoadState();
        });
    }

    /**
     * 이미지 준비가 끝날 때까지 기다립니다.
     * @returns {Promise<void>} 이미지 로드 완료 Promise입니다.
     */
    whenReady() {
        return this.destroyed || this.heroReady || this.heroFailed
            ? Promise.resolve()
            : this.readyPromise;
    }

    /**
     * NW 스모크와 진단에서 비밀정보 없이 표정 에셋 로드 상태를 확인합니다.
     * @returns {{ready:boolean,failed:boolean,requestedCount:number,readyCount:number,failedCount:number,assets:Array<object>}} 로드 요약입니다.
     */
    getHeroAssetStatus() {
        const records = Array.isArray(this.heroAssetRecords) ? this.heroAssetRecords : [];
        return {
            ready: this.heroReady,
            failed: this.heroFailed,
            requestedCount: records.length,
            readyCount: records.filter((record) => record.ready).length,
            failedCount: records.filter((record) => record.failed).length,
            assets: records.map((record) => ({
                expressions: [...record.expressions],
                src: record.image?.src || record.path,
                ready: record.ready,
                failed: record.failed,
                naturalWidth: record.image?.naturalWidth || 0,
                naturalHeight: record.image?.naturalHeight || 0
            }))
        };
    }

    /**
     * 현재 Scene 표현 컨텍스트를 Canvas에 그립니다.
     * @param {object} context - Scene이 제공하는 읽기 전용 표현 상태입니다.
     */
    draw(context) {
        if (this.destroyed || !context) return;
        this.context = context;
        this.#ensureGlassSession();
        this.#syncGlassBackdropRevision();
        this.#backdrop();
        if (context.mode === 'nickname') this.#nickname();
        else if (context.mode === 'topicSelect') this.#topics();
        else if (context.mode === 'results') this.#results();
        else this.#live();
        this.#toast();
        if (context.earlyEndModalOpen) this.#modal();
    }

    /**
     * 이미지 핸들러와 Scene 참조를 정리합니다.
     */
    destroy() {
        this.destroyed = true;
        for (const record of this.heroAssetRecords) {
            if (record.image) {
                record.image.onload = null;
                record.image.onerror = null;
            }
            record.image = null;
        }
        this.heroAssets.clear();
        this.heroAssetRecords = [];
        this.heroReady = false;
        this.heroFailed = false;
        this.glassSession?.release?.();
        this.glassSession = null;
        this.glassSessionInitialized = true;
        this.lastBlurTimeBucket = -1;
        this.contentLayer = 'ui';
        this.context = null;
    }

    /** 엔진 초기화가 끝난 첫 draw에서만 glass surface를 지연 생성합니다. @private */
    #ensureGlassSession() {
        if (this.glassSessionInitialized || this.destroyed) {
            return;
        }
        this.glassSessionInitialized = true;
        this.glassSession = this.#createGlassSession();
        this.contentLayer = this.glassSession?.uiLayerId || 'ui';
    }

    /** 움직이는 배경을 10Hz bucket으로 양자화해 blur texture 갱신 비용을 제한합니다. @private */
    #syncGlassBackdropRevision() {
        if (!this.glassSession?.effectLayerId) {
            return;
        }
        const bucket = Math.floor(Math.max(0, number(this.context?.elapsedVisualSeconds)) * 10);
        if (bucket === this.lastBlurTimeBucket) {
            return;
        }
        this.lastBlurTimeBucket = bucket;
        this.glassSession.invalidateBlur();
    }

    /** 실제 backdrop을 샘플링하는 전용 glass/effect 및 선명한 2D content surface를 만듭니다. @private */
    #createGlassSession() {
        const displaySystem = typeof getDisplaySystem === 'function' ? getDisplaySystem() : null;
        if (!displaySystem || typeof OverlaySession !== 'function') {
            return null;
        }
        try {
            return new OverlaySession({
                displaySystem,
                layer: 0,
                dim: 0,
                transparent: true,
                glOverlay: false,
                blurUpdateMode: 'dirty',
                effects: {},
                orderSequence: 0,
                disableTransparency: typeof getSetting === 'function'
                    && getSetting('disableTransparency') === true
            });
        } catch {
            return null;
        }
    }

    /** 유리 위의 텍스트와 장식을 전용 2D surface 또는 기본 UI 레이어에 그립니다. @private */
    #drawContent(options) {
        render(this.contentLayer || 'ui', options);
    }

    /** 로드된 표정 수를 기준으로 전체 에셋 상태를 갱신합니다. @private */
    #refreshHeroLoadState() {
        const records = this.heroAssetRecords;
        this.heroReady = records.some((record) => record.ready);
        this.heroFailed = records.length === 0 || records.every((record) => record.failed);
    }

    /** 요청 표정, 기본 표정, 첫 성공 에셋 순으로 안전한 이미지를 반환합니다. @private */
    #heroImageForExpression(value) {
        const expression = String(value || '').trim().toLowerCase();
        const requested = this.heroAssets.get(expression);
        if (requested?.ready && requested.image) return requested.image;
        const fallback = this.heroAssets.get(HERO_FALLBACK_EXPRESSION);
        if (fallback?.ready && fallback.image) return fallback.image;
        return this.heroAssetRecords.find((record) => record.ready && record.image)?.image || null;
    }

    /** 하늘, 구름, 수평선, 원근 그리드와 진주광 기포를 그립니다. @private */
    #backdrop() {
        const c = this.context;
        const backdropTime = Math.floor(Math.max(0, number(c.elapsedVisualSeconds)) * 10) / 10;
        const horizonY = c.WH * .54;
        const skyDeep = COLORS.SKY_DEEP || COLORS.SKY_TOP;
        const skyMid = COLORS.SKY_MID || COLORS.AQUA;
        const skyHaze = COLORS.SKY_HAZE || COLORS.SKY_BOTTOM;
        render('ui', {
            shape: 'rect', x: 0, y: 0, w: c.WW, h: c.WH,
            fill: {
                type: 'linear', x1: 0, y1: 0, x2: 0, y2: c.WH,
                stops: [
                    { offset: 0, color: skyDeep },
                    { offset: .38, color: skyMid },
                    { offset: .56, color: skyHaze },
                    { offset: .7, color: '#9DEAF1' },
                    { offset: 1, color: '#E9FDFF' }
                ]
            }
        });

        const sunX = c.UIOffsetX + c.UIWW * .83;
        const sunY = c.WH * .14;
        [110, 72, 38].forEach((radius, index) => {
            render('ui', {
                shape: 'circle', x: sunX, y: sunY, radius: radius * c.WH / 720,
                fill: index === 2 ? '#FFFBD9' : COLORS.GLASS_WHITE,
                alpha: [.08, .12, .72][index],
                shadowBlur: index === 2 ? 30 : 0,
                shadowColor: 'rgba(255,246,190,0.72)'
            });
        });

        this.#cloud(c.UIOffsetX + c.UIWW * .13, c.WH * .16, c.UIWW * .00105, .8, 0);
        this.#cloud(c.UIOffsetX + c.UIWW * .43, c.WH * .09, c.UIWW * .00082, .62, 1.7);
        this.#cloud(c.UIOffsetX + c.UIWW * .72, c.WH * .29, c.UIWW * .00095, .72, 3.2);
        this.#cloud(c.UIOffsetX + c.UIWW * .93, c.WH * .2, c.UIWW * .0007, .58, 4.4);

        render('ui', {
            shape: 'rect', x: c.UIOffsetX, y: horizonY - c.WH * .035, w: c.UIWW, h: c.WH * .11,
            fill: {
                type: 'linear', x1: 0, y1: horizonY - c.WH * .035, x2: 0, y2: horizonY + c.WH * .075,
                stops: [
                    { offset: 0, color: 'rgba(255,255,255,0)' },
                    { offset: .44, color: 'rgba(255,255,255,0.72)' },
                    { offset: .7, color: 'rgba(255,183,235,0.2)' },
                    { offset: 1, color: 'rgba(255,255,255,0)' }
                ]
            }
        });

        const gridColor = COLORS.AERO_VIOLET || '#9A85FF';
        for (let index = -8; index <= 8; index += 1) {
            render('ui', {
                shape: 'line',
                x1: c.UIOffsetX + c.UIWW * .5,
                y1: horizonY,
                x2: c.UIOffsetX + c.UIWW * (.5 + index * .095),
                y2: c.WH,
                stroke: gridColor,
                lineWidth: 1,
                alpha: .075
            });
        }
        for (let index = 1; index <= 8; index += 1) {
            const progress = index / 8;
            const y = horizonY + (c.WH - horizonY) * progress * progress;
            render('ui', {
                shape: 'line', x1: c.UIOffsetX, y1: y, x2: c.UIOffsetX + c.UIWW, y2: y,
                stroke: gridColor, lineWidth: 1, alpha: .07 + progress * .025
            });
        }

        [[.06, .72, 27], [.18, .8, 42], [.39, .66, 19], [.66, .16, 31], [.82, .76, 48], [.95, .36, 23]].forEach((seed, index) => {
            this.#backdropBubble(
                c.UIOffsetX + c.UIWW * seed[0],
                c.WH * seed[1] + Math.sin(backdropTime * .55 + index) * 7,
                seed[2] * c.WH / 720,
                index
            );
        });
    }

    /** 여러 원과 광택 띠로 흐릿한 구름 덩어리를 만듭니다. @private */
    #cloud(x, y, scale, alpha, phase) {
        const backdropTime = Math.floor(Math.max(0, number(this.context.elapsedVisualSeconds)) * 10) / 10;
        const drift = Math.sin(backdropTime * .12 + phase) * 10;
        const lobes = [[-70, 5, 38], [-28, -12, 52], [18, 0, 43], [58, 8, 31]];
        lobes.forEach(([offsetX, offsetY, radius]) => {
            render('ui', {
                shape: 'circle',
                x: x + drift + offsetX * scale,
                y: y + offsetY * scale,
                radius: Math.max(8, radius * scale),
                fill: COLORS.CLOUD_WHITE || COLORS.GLASS_WHITE,
                alpha,
                shadowBlur: Math.max(8, 18 * scale),
                shadowColor: 'rgba(210,246,255,0.52)'
            });
        });
        render('ui', {
            shape: 'roundRect',
            x: x + drift - 82 * scale,
            y: y + 5 * scale,
            w: 164 * scale,
            h: Math.max(14, 36 * scale),
            radius: 999,
            fill: COLORS.CLOUD_WHITE || COLORS.GLASS_WHITE,
            alpha: alpha * .94
        });
    }

    /** 투명 테두리와 작은 반사점이 있는 진주광 기포를 그립니다. @private */
    #backdropBubble(x, y, radius, index) {
        const pink = COLORS.AERO_PINK || '#FF86D7';
        this.#backdropBubbleShell(x, y, radius, pink, index);
        render('ui', {
            shape: 'circle',
            x: x - radius * .31,
            y: y - radius * .34,
            radius: Math.max(2, radius * .12),
            fill: COLORS.GLASS_WHITE,
            alpha: .76,
            shadowBlur: Math.max(3, radius * .16),
            shadowColor: COLORS.GLASS_WHITE
        });
    }

    /** 기포 외피를 별도 메서드로 그려 테스트 가능한 배경 draw command를 유지합니다. @private */
    #backdropBubbleShell(x, y, radius, accent, index) {
        render('ui', {
            shape: 'circle', x, y, radius,
            fill: index % 2 === 0 ? 'rgba(235,254,255,0.11)' : 'rgba(255,225,250,0.1)',
            stroke: index % 2 === 0 ? COLORS.GLASS_BORDER : accent,
            lineWidth: Math.max(1.2, radius * .055),
            alpha: .58,
            shadowBlur: Math.max(4, radius * .18),
            shadowColor: index % 2 === 0 ? 'rgba(71,216,255,0.26)' : 'rgba(255,134,215,0.24)'
        });
    }

    /** 프로토타입 시작 전 로컬 닉네임 입력 안내를 그립니다. @private */
    #nickname() {
        const c = this.context;
        const rect = c.layout.nicknamePanel;
        const center = c.UIOffsetX + c.UIWW / 2;
        this.#label('AERO LIVE', center, c.WH * .1, this.#size(UI.TITLE_FONT_WH), COLORS.INK, {
            align: 'center',
            weight: 950,
            shadowBlur: 16,
            shadowColor: 'rgba(66,224,208,0.48)'
        });
        this.#panel(rect, {
            fill: COLORS.GLASS_FILL_STRONG,
            stroke: c.nicknameInvalid ? COLORS.NEGATIVE : COLORS.AQUA,
            edgeColor: c.nicknameInvalid ? COLORS.NEGATIVE : COLORS.AQUA,
            tintColor: COLORS.AQUA,
            tintStrength: .1,
            lineWidth: 2.2,
            shadowColor: c.nicknameInvalid ? COLORS.NEGATIVE : COLORS.AQUA,
            shadowRadius: 22
        });
        this.#label(
            '방송에서 사용할 닉네임을 정해 주세요',
            rect.x + rect.w / 2,
            rect.y + rect.h * .17,
            this.#size(UI.SUBTITLE_FONT_WH) * 1.08,
            COLORS.INK,
            { align: 'center', weight: 950, maxWidth: rect.w * .86 }
        );
        this.#wrapped(
            '닉네임은 AI에 전송되지 않고 이 화면에서만 사용됩니다.',
            rect.x + rect.w * .1,
            rect.y + rect.h * .35,
            rect.w * .8,
            this.#size(UI.BODY_FONT_WH),
            COLORS.DEEP_BLUE,
            2,
            'center'
        );
        this.#label(
            c.nicknameInvalid
                ? '입력 형식을 확인해 주세요 · 한글·영문·숫자·밑줄 2~16자'
                : '한글·영문·숫자·밑줄 2~16자',
            rect.x + rect.w / 2,
            rect.y + rect.h * .49,
            this.#size(UI.SMALL_FONT_WH),
            c.nicknameInvalid ? COLORS.NEGATIVE : COLORS.INK_MUTED,
            { align: 'center', weight: 850, maxWidth: rect.w * .84 }
        );
    }

    /** 다섯 방송 주제 카드와 조작 안내를 그립니다. @private */
    #topics() {
        const c = this.context;
        const center = c.UIOffsetX + c.UIWW / 2;
        this.#label('AERO LIVE', center, c.WH * .095, this.#size(UI.TITLE_FONT_WH), COLORS.INK, {
            align: 'center', weight: 950, shadowBlur: 16, shadowColor: 'rgba(66,224,208,0.48)'
        });
        this.#label(
            `${c.playerName || '플레이어'}님, 오늘 방송 주제를 선택해 주세요`,
            center,
            c.WH * .17,
            this.#size(UI.BODY_FONT_WH),
            COLORS.DEEP_BLUE,
            { align: 'center', weight: 850, maxWidth: c.UIWW * .72 }
        );

        c.topicButtons.forEach((button, index) => {
            const topic = c.topicSummaries[index] || {};
            const rect = this.#buttonRect(button);
            const accent = TOPIC_ACCENTS[index % TOPIC_ACCENTS.length];
            this.#panel(rect, {
                fill: COLORS.GLASS_FILL_STRONG,
                stroke: accent,
                edgeColor: accent,
                tintColor: accent,
                tintStrength: .08,
                shadowColor: accent,
                shadowRadius: 10 + button.hoverValue * 12,
                lineWidth: 2 + button.hoverValue * 2
            });
            const accentBar = { x: rect.x + rect.w * .07, y: rect.y + rect.h * .07, w: rect.w * .86, h: Math.max(7, rect.h * .055) };
            this.#drawContent({
                shape: 'roundRect', ...accentBar, radius: 999,
                fill: {
                    type: 'linear', x1: accentBar.x, y1: 0, x2: accentBar.x + accentBar.w, y2: 0,
                    stops: [
                        { offset: 0, color: accent },
                        { offset: .48, color: COLORS.GLASS_WHITE },
                        { offset: 1, color: accent }
                    ]
                },
                shadowBlur: 8 + button.hoverValue * 10,
                shadowColor: accent
            });
            const numberRadius = Math.min(rect.w, rect.h) * .095;
            this.#drawContent({
                shape: 'circle', x: rect.x + rect.w * .16, y: rect.y + rect.h * .28, radius: numberRadius,
                fill: accent, stroke: COLORS.GLASS_BORDER, lineWidth: 1.4,
                shadowBlur: 10 + button.hoverValue * 10, shadowColor: accent
            });
            this.#drawContent({
                shape: 'circle', x: rect.x + rect.w * .16 - numberRadius * .3, y: rect.y + rect.h * .28 - numberRadius * .32,
                radius: Math.max(2, numberRadius * .14), fill: COLORS.GLASS_WHITE, alpha: .72
            });
            this.#label(String(index + 1), rect.x + rect.w * .16, rect.y + rect.h * .28, this.#size(UI.SUBTITLE_FONT_WH), COLORS.GLASS_WHITE, { align: 'center', baseline: 'middle', weight: 950 });
            this.#label(topic.shortTitle || topic.title || `주제 ${index + 1}`, rect.x + rect.w * .54, rect.y + rect.h * .28, this.#size(UI.SUBTITLE_FONT_WH), COLORS.INK, { align: 'center', baseline: 'middle', weight: 950, maxWidth: rect.w * .58 });
            this.#wrapped(topic.concept || '특별 방송', rect.x + rect.w * .08, rect.y + rect.h * .47, rect.w * .84, this.#size(UI.BODY_FONT_WH), COLORS.INK, 2, 'center');
            this.#label(`${topic.beatCount || '-'} BEATS · 약 ${Math.max(1, Math.round(number(topic.estimatedSeconds) / 60))}분`, rect.x + rect.w / 2, rect.y + rect.h * .84, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { align: 'center', weight: 750, maxWidth: rect.w * .85 });
        });

    }

    /** 3열 방송 화면을 그립니다. @private */
    #live() {
        this.#topBar();
        this.#leftPanel();
        this.#hero();
        this.#chatPanel();
    }

    /** 방송 상단 상태 바를 그립니다. @private */
    #topBar() {
        const c = this.context;
        const rect = c.layout.topBar;
        const m = c.snapshot?.metrics || {};
        const pad = c.layout.panelPad;
        this.#panel(rect, { fill: COLORS.GLASS_FILL_STRONG, tintStrength: .15 });
        const pill = { x: rect.x + pad * .6, y: rect.y + rect.h * .24, w: Math.max(64, rect.h * 1.25), h: rect.h * .52 };
        this.#drawContent({ shape: 'roundRect', ...pill, radius: 999, fill: COLORS.LIVE });
        this.#label('● LIVE', pill.x + pill.w / 2, pill.y + pill.h / 2, this.#size(UI.SMALL_FONT_WH), COLORS.GLASS_WHITE, { align: 'center', baseline: 'middle', weight: 950 });
        const titleX = pill.x + pill.w + pad * .7;
        this.#label(c.snapshot?.topic?.title || 'AERO LIVE', titleX, rect.y + rect.h * .34, this.#size(UI.SUBTITLE_FONT_WH), COLORS.INK, { baseline: 'middle', weight: 950, maxWidth: rect.w * .26 });
        const mood = c.snapshot?.currentBeat?.mood;
        this.#label(`${clock(c.snapshot?.elapsedSeconds)} · ${MOOD_LABELS[mood] || text(mood || '방송 중', 20)}`, titleX, rect.y + rect.h * .68, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { baseline: 'middle', weight: 700 });
        this.#button(c.endButton, '방송 종료', COLORS.DARK_GLASS, COLORS.NEGATIVE, COLORS.GLASS_WHITE);
        const endX = c.layout.endButton.x - pad;
        const statW = Math.min(125, rect.w * .1);
        [['시청자', integer(m.viewers), COLORS.DEEP_BLUE], ['참여도', `${Math.round(number(m.engagement))}%`, COLORS.AQUA], ['수익', `${integer(m.revenue)}원`, COLORS.POSITIVE]].forEach((item, i) => {
            const x = endX - statW * (3 - i);
            this.#label(item[0], x + statW / 2, rect.y + rect.h * .3, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { align: 'center', baseline: 'middle', weight: 700 });
            this.#label(item[1], x + statW / 2, rect.y + rect.h * .65, this.#size(UI.METRIC_FONT_WH), item[2], { align: 'center', baseline: 'middle', weight: 950, maxWidth: statW * .92 });
        });
        this.#label(c.aiStatus || 'AI 준비', endX - statW * 3 - pad * .5, rect.y + rect.h / 2, this.#size(UI.SMALL_FONT_WH), COLORS.DEEP_BLUE, { align: 'right', baseline: 'middle', weight: 800, maxWidth: rect.w * .11 });
    }

    /** 후원 카드, 방송 지표와 여섯 감정 지시를 그립니다. @private */
    #leftPanel() {
        const c = this.context;
        const rect = c.layout.left;
        const m = c.snapshot?.metrics || {};
        this.#panel(rect, { fill: COLORS.GLASS_FILL, alpha: .92, tintStrength: .16 });
        this.#label('프로듀서 콘솔', rect.x + c.layout.panelPad, rect.y + c.layout.panelPad * .68, this.#size(UI.SUBTITLE_FONT_WH), COLORS.INK, { baseline: 'middle', weight: 950 });
        this.#label(`강퇴 ${integer(c.snapshot?.resources?.kicksRemaining)}회`, rect.x + rect.w - c.layout.panelPad, rect.y + c.layout.panelPad * .68, this.#size(UI.SMALL_FONT_WH), COLORS.NEGATIVE, { align: 'right', baseline: 'middle', weight: 850 });
        this.#donation();
        const rows = [
            ['스트레스', m.stress, COLORS.NEGATIVE, false],
            ['호감도', m.affection, COLORS.POSITIVE, false],
            ['여론', m.opinion, COLORS.DEEP_BLUE, true],
            ['참여도', m.engagement, COLORS.AQUA, false]
        ];
        const area = c.layout.metricArea;
        rows.forEach((row, index) => this.#meter(row[0], row[1], row[2], { x: area.x, y: area.y + area.h / 4 * index, w: area.w, h: area.h / 4 }, row[3]));
        c.donationButtons.forEach((button) => this.#button(button, button.aeroData?.label || '지시', COLORS.DARK_GLASS, COLORS.AQUA, COLORS.GLASS_WHITE, button.aeroDisabled));
    }

    /** 활성 후원 또는 대기 카드를 그립니다. @private */
    #donation() {
        const c = this.context;
        const d = c.snapshot?.activeDonation;
        const rect = c.layout.donationCard;
        this.#panel(rect, { fill: d ? 'rgba(255,214,90,0.22)' : COLORS.GLASS_FILL_STRONG, stroke: d ? COLORS.WARNING : COLORS.GLASS_BORDER, lineWidth: d ? 2.5 : 1.2 });
        if (!d) {
            this.#label('후원 신호 대기 중', rect.x + rect.w / 2, rect.y + rect.h * .43, this.#size(UI.SUBTITLE_FONT_WH), COLORS.INK, { align: 'center', baseline: 'middle', weight: 900 });
            return;
        }
        this.#label(`${text(d.author, 24)} · ${integer(d.amount)}원`, rect.x + rect.w * .07, rect.y + rect.h * .19, this.#size(UI.BODY_FONT_WH), COLORS.INK, { baseline: 'middle', weight: 950, maxWidth: rect.w * .86 });
        this.#wrapped(d.text, rect.x + rect.w * .07, rect.y + rect.h * .34, rect.w * .86, this.#size(UI.BODY_FONT_WH), COLORS.INK, 2);
        this.#timer({ x: rect.x + rect.w * .07, y: rect.y + rect.h * .81, w: rect.w * .86, h: Math.max(8, rect.h * .08) }, d.timeRemainingSeconds, c.timerMaximums.donation, COLORS.WARNING, '후원', COLORS.INK);
    }

    /** 중앙 히로인 스튜디오와 대사를 그립니다. @private */
    #hero() {
        const c = this.context;
        const stage = c.layout.heroStage;
        const dialogue = c.layout.heroDialogue;
        const beat = c.snapshot?.currentBeat || {};
        const activeDonation = c.snapshot?.activeDonation;
        const activeExpression = c.heroResponseText
            ? (c.heroResponseExpression || beat.expression)
            : beat.expression;
        const heroImage = this.#heroImageForExpression(activeExpression);
        this.#panel(c.layout.center, { fill: COLORS.GLASS_FILL, alpha: .89, tintColor: COLORS.AERO_PINK || COLORS.SKY_HAZE, tintStrength: .07 });
        this.#drawContent({
            shape: 'roundRect',
            x: stage.x - 2, y: stage.y - 2, w: stage.w + 4, h: stage.h + 4,
            radius: this.#radius() + 2,
            fill: 'rgba(255,255,255,0.14)',
            stroke: COLORS.AQUA,
            lineWidth: 2,
            shadowBlur: 18,
            shadowColor: 'rgba(66,224,208,0.35)'
        });
        this.#drawContent({ shape: 'roundRect', ...stage, radius: this.#radius(), fill: heroImage ? COLORS.GLASS_WHITE : COLORS.DARK_GLASS });
        if (heroImage) this.#imageUpperBody(stage, heroImage);
        else {
            this.#drawContent({ shape: 'circle', x: stage.x + stage.w / 2, y: stage.y + stage.h * .49, radius: Math.min(stage.w, stage.h) * .22, fill: COLORS.AQUA, alpha: .45 });
            this.#label('AERO', stage.x + stage.w / 2, stage.y + stage.h * .49, this.#size(UI.TITLE_FONT_WH), COLORS.GLASS_WHITE, { align: 'center', baseline: 'middle', weight: 950 });
        }
        this.#drawContent({
            shape: 'roundRect', ...stage, radius: this.#radius(), fill: false,
            stroke: COLORS.GLASS_BORDER, lineWidth: 2
        });
        this.#drawContent({
            shape: 'roundRect',
            x: stage.x + stage.w * .08,
            y: stage.y + stage.h - Math.max(4, stage.h * .012),
            w: stage.w * .84,
            h: Math.max(4, stage.h * .012),
            radius: 999,
            fill: {
                type: 'linear', x1: stage.x, y1: 0, x2: stage.x + stage.w, y2: 0,
                stops: [
                    { offset: 0, color: COLORS.AQUA },
                    { offset: .5, color: COLORS.GLASS_WHITE },
                    { offset: 1, color: COLORS.AERO_PINK || '#FF86D7' }
                ]
            },
            alpha: .84,
            shadowBlur: 10,
            shadowColor: COLORS.AERO_PINK || '#FF86D7'
        });
        const tag = { x: stage.x + stage.w * .03, y: stage.y + stage.h * .035, w: stage.w * .31, h: Math.max(28, stage.h * .075) };
        this.#drawContent({ shape: 'roundRect', ...tag, radius: 999, fill: COLORS.DARK_GLASS, alpha: .84 });
        const expressionLabel = EXPRESSION_LABELS[activeExpression]
            || text(activeExpression || '기본', 14);
        const moodLabel = MOOD_LABELS[beat.mood] || text(beat.mood || '평온', 14);
        this.#label(`${expressionLabel} · ${moodLabel}`, tag.x + tag.w / 2, tag.y + tag.h / 2, this.#size(UI.SMALL_FONT_WH), COLORS.GLASS_WHITE, { align: 'center', baseline: 'middle', weight: 850, maxWidth: tag.w * .9 });
        if (activeDonation) {
            this.#timer({ x: stage.x + stage.w * .2, y: stage.y + stage.h * .91, w: stage.w * .6, h: Math.max(9, stage.h * .022) }, activeDonation.timeRemainingSeconds, c.timerMaximums.donation, COLORS.WARNING, '후원 디렉션');
        }
        this.#panel(dialogue, {
            fill: 'rgba(7,35,59,0.34)',
            contentTint: 'rgba(5,30,51,0.7)',
            stroke: COLORS.AQUA,
            edgeColor: COLORS.AQUA,
            lineWidth: 1.5
        });
        this.#label(`BEAT ${number(beat.index) + 1} / ${Math.max(1, number(beat.total, 1))}`, dialogue.x + dialogue.w * .055, dialogue.y + dialogue.h * .22, this.#size(UI.SMALL_FONT_WH), COLORS.AQUA, { baseline: 'middle', weight: 900 });
        if (c.heroResponseText) {
            const responseLabel = c.heroResponseLabel || '실시간 답변';
            this.#label(responseLabel, dialogue.x + dialogue.w * .23, dialogue.y + dialogue.h * .22, this.#size(UI.SMALL_FONT_WH), responseLabel === '채팅 답변' ? COLORS.AQUA : COLORS.WARNING, { baseline: 'middle', weight: 900 });
        }
        this.#wrapped(c.heroResponseText || beat.heroText || '방송 시작을 준비하고 있어요.', dialogue.x + dialogue.w * .055, dialogue.y + dialogue.h * .4, dialogue.w * .89, this.#size(UI.DIALOGUE_FONT_WH), COLORS.GLASS_WHITE, 3);
    }

    /** 우측 일반·핵심 채팅과 관리 버튼을 그립니다. @private */
    #chatPanel() {
        const c = this.context;
        const rect = c.layout.right;
        const resources = c.snapshot?.resources || {};
        this.#panel(rect, { fill: COLORS.GLASS_FILL, alpha: .92, tintStrength: .16 });
        this.#label('실시간 채팅', rect.x + c.layout.panelPad, rect.y + c.layout.panelPad * .68, this.#size(UI.SUBTITLE_FONT_WH), COLORS.INK, { baseline: 'middle', weight: 950 });
        this.#label(`자유 채팅 ${integer(resources.playerMessagesRemaining)}회`, rect.x + rect.w - c.layout.panelPad, rect.y + c.layout.panelPad * .68, this.#size(UI.SMALL_FONT_WH), COLORS.DEEP_BLUE, { align: 'right', baseline: 'middle', weight: 850 });
        this.#chats();
        c.coreButtons.forEach((button) => {
            const id = button.aeroData?.id;
            const label = id === 'kick' ? `강퇴 ${integer(resources.kicksRemaining)}` : button.aeroData?.label;
            this.#button(button, label || '처리', COLORS.DARK_GLASS, CORE_COLORS[id] || COLORS.AQUA, COLORS.GLASS_WHITE, button.aeroDisabled);
        });
        const composer = c.layout.composer;
        const state = c.inputClassificationPending
            ? 'AI 판정 중 · 활성 이벤트 타이머 일시정지'
            : `${c.playerName || '플레이어'}님의 닉네임은 AI에 전송되지 않습니다.`;
        this.#label(state, composer.x, composer.y - c.layout.gap * .42, this.#size(UI.SMALL_FONT_WH), c.inputClassificationPending ? COLORS.NEGATIVE : COLORS.INK_MUTED, { baseline: 'bottom', weight: 800, maxWidth: composer.w });
    }

    /** 최근 일반·핵심 채팅을 같은 피드의 고정 행으로 그립니다. @private */
    #chats() {
        const c = this.context;
        const rect = c.layout.chatArea;
        const count = Math.max(1, Math.floor(number(UI.CHAT_VISIBLE_COUNT, 9)));
        const chats = Array.isArray(c.snapshot?.chats) ? c.snapshot.chats : [];
        const rows = Array.isArray(c.visibleChatRows)
            ? c.visibleChatRows
            : buildVisibleChatRows({
                chats,
                rect,
                visibleCount: count,
                preferredLineHeight: c.WH * UI.CHAT_LINE_HEIGHT_WH / 100
            });
        this.#drawContent({ shape: 'roundRect', ...rect, radius: this.#radius() * .7, fill: 'rgba(245,254,255,0.34)', stroke: COLORS.GLASS_BORDER, lineWidth: 1 });
        if (!rows.length) {
            this.#label('시청자 채팅을 기다리는 중입니다.', rect.x + rect.w / 2, rect.y + rect.h / 2, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { align: 'center', baseline: 'middle', weight: 700 });
            return;
        }
        rows.forEach(({ chat = {}, rect: row }) => {
            const core = chat.kind === 'core' || chat.source === 'core' || !!chat.coreChatId;
            const coreId = chat.coreChatId || chat.id;
            const activeCoreId = c.snapshot?.activeCoreChat?.id;
            const coreActive = core && (chat.status === 'active' || (activeCoreId && coreId === activeCoreId));
            const coreSelected = core && !!c.selectedCoreChatId && coreId === c.selectedCoreChatId;
            const accent = core
                ? COLORS.NEGATIVE
                : chat.sentiment === 'positive'
                    ? COLORS.POSITIVE
                    : chat.sentiment === 'negative'
                        ? COLORS.NEGATIVE
                        : COLORS.NEUTRAL;
            const player = chat.source === 'player' && chat.masked === true;
            const rowFill = coreSelected
                ? 'rgba(255,214,90,0.3)'
                : coreActive
                    ? 'rgba(255,107,120,0.22)'
                    : player
                        ? 'rgba(66,224,208,0.18)'
                        : COLORS.GLASS_FILL_STRONG;
            this.#drawContent({
                shape: 'roundRect', ...row, radius: Math.max(4, row.h * .2),
                fill: rowFill,
                stroke: coreSelected ? COLORS.WARNING : coreActive ? COLORS.NEGATIVE : undefined,
                lineWidth: coreSelected ? 2 : coreActive ? 1.35 : 0,
                shadowBlur: coreSelected ? 8 : 0,
                shadowColor: coreSelected ? COLORS.WARNING : undefined,
                alpha: core && !coreActive && !coreSelected ? .66 : .9
            });
            this.#drawContent({ shape: 'roundRect', x: row.x + 5, y: row.y + row.h * .25, w: 5, h: row.h * .5, radius: 999, fill: accent });
            const authorW = core ? Math.min(row.w * .39, 126) : Math.min(row.w * .31, 96);
            const author = core
                ? `CORE · ${chat.author || chat.viewer_id || 'viewer'}`
                : (player
                    ? (c.playerName || '플레이어')
                    : chat.author || chat.viewer_id || 'viewer');
            const textRight = row.x + row.w - 8;
            this.#label(author, row.x + 15, row.y + row.h / 2, this.#size(UI.SMALL_FONT_WH), player ? COLORS.DEEP_BLUE : accent, { baseline: 'middle', weight: 900, maxWidth: authorW - 18 });
            this.#label(chat.text, row.x + authorW, row.y + row.h / 2, this.#size(UI.SMALL_FONT_WH), COLORS.INK, { baseline: 'middle', weight: player || core ? 800 : 650, maxWidth: Math.max(20, textRight - (row.x + authorW)), clipRect: row });
            if (coreActive) {
                this.#inlineCoreTimer(row, chat.timeRemainingSeconds ?? c.snapshot?.activeCoreChat?.timeRemainingSeconds);
            }
        });
    }

    /** 핵심 채팅 행 하단 전체 폭에 텍스트 없는 카운트다운 바를 붙입니다. @private */
    #inlineCoreTimer(row, remaining) {
        const left = Math.max(0, number(remaining));
        const maximum = Math.max(.001, number(this.context.timerMaximums?.core, left || 1));
        const ratio = clamp(left / maximum, 0, 1);
        const bar = {
            x: row.x,
            y: row.y + row.h - Math.max(4, row.h * .14),
            w: row.w,
            h: Math.max(4, row.h * .14)
        };
        this.#drawContent({
            shape: 'roundRect', ...bar, radius: 999,
            fill: COLORS.DARK_GLASS,
            alpha: .78,
            clipRect: row
        });
        if (ratio > 0) {
            this.#drawContent({
                shape: 'roundRect',
                x: bar.x,
                y: bar.y,
                w: Math.max(2, bar.w * ratio),
                h: bar.h,
                radius: 999,
                fill: COLORS.NEGATIVE,
                shadowBlur: 4,
                shadowColor: COLORS.NEGATIVE,
                clipRect: row
            });
        }
    }

    /** 방송 결과 요약과 재시작 버튼을 그립니다. @private */
    #results() {
        const c = this.context;
        const result = c.snapshot?.result || {};
        const start = result.startMetrics || {};
        const m = result.finalMetrics || c.snapshot?.metrics || {};
        const metricDelta = result.metricDelta || {};
        const s = c.snapshot?.stats || {};
        const core = result.coreChats || {};
        const moderation = result.moderation || {};
        const playerMessages = result.playerMessages || {};
        const donations = result.donations || {};
        const endType = result.endType || c.snapshot?.endType || 'normal';
        const endLabels = { normal: '방송 완료', early: '조기 종료', emergency: '긴급 종료' };
        const endColor = endType === 'emergency' ? COLORS.NEGATIVE : endType === 'early' ? COLORS.WARNING : COLORS.POSITIVE;
        const center = c.UIOffsetX + c.UIWW / 2;
        this.#label(endLabels[endType] || '방송 종료', center, c.WH * .085, this.#size(UI.TITLE_FONT_WH), endColor, { align: 'center', weight: 950 });
        this.#label(`${text(c.snapshot?.topic?.title || result.topic?.title || 'AERO LIVE', 50)} · ${clock(result.durationSeconds ?? c.snapshot?.elapsedSeconds)}`, center, c.WH * .145, this.#size(UI.SUBTITLE_FONT_WH), COLORS.INK, { align: 'center', weight: 850 });

        const outer = { x: c.UIOffsetX + c.UIWW * .065, y: c.WH * .19, w: c.UIWW * .87, h: c.WH * .58 };
        const left = { x: outer.x, y: outer.y, w: outer.w * .39, h: outer.h };
        const right = { x: left.x + left.w + c.layout.gap, y: outer.y, w: outer.w - left.w - c.layout.gap, h: outer.h };
        this.#panel(left, { fill: COLORS.GLASS_FILL_STRONG, tintStrength: .14 });
        this.#panel(right, { fill: COLORS.GLASS_FILL_STRONG, tintColor: COLORS.AERO_PINK || COLORS.SKY_HAZE, tintStrength: .06 });
        const leftX = left.x + left.w * .065;
        const leftW = left.w * .87;
        this.#label('시청자와 최종 지표', leftX, left.y + left.h * .07, this.#size(UI.SUBTITLE_FONT_WH), COLORS.DEEP_BLUE, { baseline: 'middle', weight: 950 });
        const viewerGap = Math.max(4, c.layout.gap * .45);
        const viewerCardW = (leftW - viewerGap * 2) / 3;
        const viewerCardY = left.y + left.h * .12;
        const viewerCardH = left.h * .125;
        [
            ['시작', integer(start.viewers), COLORS.INK],
            ['종료', integer(m.viewers), COLORS.AQUA],
            ['최고 동시', integer(result.peakViewers ?? m.peakViewers ?? m.viewers), COLORS.DEEP_BLUE]
        ].forEach((item, index) => this.#resultStat(item[0], item[1], {
            x: leftX + index * (viewerCardW + viewerGap), y: viewerCardY, w: viewerCardW, h: viewerCardH
        }, item[2], true));

        const positiveRatio = clamp(result.positiveViewerRatio ?? (number(m.viewers) > 0 ? number(m.positiveViewers) / number(m.viewers) * 100 : 0), 0, 100);
        const negativeRatio = clamp(100 - positiveRatio, 0, 100);
        const splitY = left.y + left.h * .265;
        this.#resultStat('긍정 시청자', `${integer(m.positiveViewers)}명 · ${positiveRatio.toFixed(1)}%`, { x: leftX, y: splitY, w: leftW, h: left.h * .072 }, COLORS.POSITIVE);
        this.#resultStat('부정 시청자', `${integer(m.negativeViewers)}명 · ${negativeRatio.toFixed(1)}%`, { x: leftX, y: splitY + left.h * .079, w: leftW, h: left.h * .072 }, COLORS.NEGATIVE);

        const meters = [
            [`스트레스 Δ${delta(metricDelta.stress)}`, m.stress, COLORS.NEGATIVE, false],
            [`호감도 Δ${delta(metricDelta.affection)}`, m.affection, COLORS.POSITIVE, false],
            ['최종 여론', m.opinion, COLORS.DEEP_BLUE, true],
            ['최종 참여도', m.engagement, COLORS.AQUA, false]
        ];
        meters.forEach((row, index) => this.#meter(row[0], row[1], row[2], {
            x: leftX,
            y: left.y + left.h * (.435 + index * .105),
            w: leftW,
            h: left.h * .09
        }, row[3]));
        this.#resultStat('총 후원금', `${integer(donations.revenue ?? m.revenue)}원`, { x: leftX, y: left.y + left.h * .875, w: leftW, h: left.h * .085 }, COLORS.POSITIVE);

        const rightX = right.x + right.w * .05;
        const rightW = right.w * .9;
        this.#label('프로듀서 리포트', rightX, right.y + right.h * .07, this.#size(UI.SUBTITLE_FONT_WH), COLORS.DEEP_BLUE, { baseline: 'middle', weight: 950 });
        const ratingLabels = {
            'healthy-community': '건강한 커뮤니티',
            'balanced-broadcast': '균형 잡힌 방송',
            'volatile-growth': '위태로운 성장',
            'protective-early-end': '보호적 조기 종료',
            'emergency-collapse': '방송 붕괴'
        };
        this.#label(ratingLabels[result.rating] || text(result.rating, 24), rightX + rightW, right.y + right.h * .07, this.#size(UI.BODY_FONT_WH), endColor, { align: 'right', baseline: 'middle', weight: 900, maxWidth: rightW * .42 });
        const report = [
            ['핵심 채팅 성공', `${integer(core.succeeded ?? s.coreChatsSucceeded)}/${integer(core.presented ?? s.coreChatsPresented)}건`, COLORS.DEEP_BLUE],
            ['긍정 채팅 오강퇴', `${integer(core.wrongPositiveKicks ?? s.wrongPositiveKicks)}건`, COLORS.NEGATIVE],
            ['강퇴 · 삭제', `${integer(moderation.kicksUsed ?? s.kicksUsed)}회 · ${integer(moderation.deletedMessages ?? s.coreChatsDeleted)}건`, COLORS.NEGATIVE],
            ['후원 적절 대응', `${integer(donations.appropriate ?? s.donationsAppropriate)}건`, COLORS.POSITIVE],
            ['후원 실패', `${integer(donations.failed ?? s.donationFailures)}건`, COLORS.WARNING],
            ['후원 총 발생', `${integer(donations.presented ?? s.donationsPresented)}건`, COLORS.AQUA]
        ];
        const reportGap = Math.max(4, c.layout.gap * .5);
        const reportW = (rightW - reportGap) / 2;
        report.forEach((item, index) => {
            const column = index % 2;
            const rowIndex = Math.floor(index / 2);
            this.#resultStat(item[0], item[1], {
                x: rightX + column * (reportW + reportGap),
                y: right.y + right.h * (.125 + rowIndex * .105),
                w: reportW,
                h: right.h * .085
            }, item[2]);
        });

        const intentLabels = { praise: '칭찬·응원', rebuttal: '반박·중재', provocation: '선동·자극', neutral: '중립', blocked: '전송 불가' };
        const intents = Array.isArray(playerMessages.intents)
            ? playerMessages.intents.slice(0, 3).map((intent) => intentLabels[intent] || text(intent, 18))
            : [];
        while (intents.length < 3) intents.push('미사용');
        const intentRect = { x: rightX, y: right.y + right.h * .45, w: rightW, h: right.h * .105 };
        this.#drawContent({ shape: 'roundRect', ...intentRect, radius: this.#radius() * .5, fill: 'rgba(66,224,208,0.13)' });
        this.#label(`자유 채팅 판정 · ${integer(playerMessages.used ?? s.playerMessagesUsed)}/3회`, intentRect.x + intentRect.w * .035, intentRect.y + intentRect.h * .25, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { baseline: 'middle', weight: 850 });
        this.#label(intents.map((intent, index) => `${index + 1} ${intent}`).join('  ·  '), intentRect.x + intentRect.w * .035, intentRect.y + intentRect.h * .68, this.#size(UI.BODY_FONT_WH), COLORS.DEEP_BLUE, { baseline: 'middle', weight: 900, maxWidth: intentRect.w * .93 });

        const memories = Array.isArray(c.echoMemories) ? c.echoMemories : [];
        const latestMemory = memories[memories.length - 1];
        const memoryRect = {
            x: rightX,
            y: right.y + right.h * .585,
            w: rightW,
            h: right.h * .17
        };
        this.#drawContent({
            shape: 'roundRect',
            ...memoryRect,
            radius: this.#radius() * .5,
            fill: latestMemory ? 'rgba(154,133,255,0.14)' : 'rgba(95,203,255,0.1)'
        });
        this.#label(
            latestMemory ? `방송이 기억한 순간 · ${integer(memories.length)}개` : '주요 순간',
            memoryRect.x + memoryRect.w * .035,
            memoryRect.y + memoryRect.h * .2,
            this.#size(UI.SMALL_FONT_WH),
            latestMemory ? (COLORS.AERO_VIOLET || COLORS.AQUA) : COLORS.INK_MUTED,
            { baseline: 'middle', weight: 900, maxWidth: memoryRect.w * .93 }
        );
        if (latestMemory) {
            this.#label(
                `${c.playerName || '플레이어'} · ${latestMemory.playerMessage}`,
                memoryRect.x + memoryRect.w * .035,
                memoryRect.y + memoryRect.h * .43,
                this.#size(UI.SMALL_FONT_WH),
                COLORS.DEEP_BLUE,
                { baseline: 'middle', weight: 850, maxWidth: memoryRect.w * .93 }
            );
            this.#label(
                `AERO · ${latestMemory.heroReply}`,
                memoryRect.x + memoryRect.w * .035,
                memoryRect.y + memoryRect.h * .66,
                this.#size(UI.SMALL_FONT_WH),
                COLORS.INK,
                { baseline: 'middle', weight: 800, maxWidth: memoryRect.w * .93 }
            );
            if (latestMemory.callbackText) {
                this.#label(
                    `채팅 · ${latestMemory.callbackText}`,
                    memoryRect.x + memoryRect.w * .035,
                    memoryRect.y + memoryRect.h * .87,
                    this.#size(UI.SMALL_FONT_WH),
                    COLORS.INK_MUTED,
                    { baseline: 'middle', weight: 750, maxWidth: memoryRect.w * .93 }
                );
            }
        } else {
            const moments = Array.isArray(result.majorMoments) ? result.majorMoments : [];
            const momentLines = moments.slice(-2)
                .map((item) => text(item.text || item.label || item, 76))
                .filter(Boolean);
            const momentFontSize = this.#size(UI.SMALL_FONT_WH);
            momentLines.forEach((line, index) => {
                this.#label(`• ${line}`, memoryRect.x + memoryRect.w * .035, memoryRect.y + memoryRect.h * (.48 + index * .28), momentFontSize, COLORS.INK, { baseline: 'middle', weight: 750, maxWidth: memoryRect.w * .93 });
            });
        }
        const heroRect = { x: rightX, y: right.y + right.h * .785, w: rightW, h: right.h * .15 };
        this.#drawContent({ shape: 'roundRect', ...heroRect, radius: this.#radius() * .55, fill: COLORS.DARK_GLASS });
        this.#label('히로인의 한마디', heroRect.x + heroRect.w * .035, heroRect.y + heroRect.h * .25, this.#size(UI.SMALL_FONT_WH), COLORS.AQUA, { baseline: 'middle', weight: 900 });
        this.#wrapped(result.heroComment || '다음 방송에서도 함께해 줘.', heroRect.x + heroRect.w * .035, heroRect.y + heroRect.h * .47, heroRect.w * .93, this.#size(UI.BODY_FONT_WH), COLORS.GLASS_WHITE, 2);
        this.#button(c.resultRestartButton, '같은 주제 재방송', COLORS.DEEP_BLUE, COLORS.GLASS_BORDER, COLORS.GLASS_WHITE);
        this.#button(c.resultTopicsButton, '다른 주제 선택', COLORS.GLASS_FILL_STRONG, COLORS.DEEP_BLUE, COLORS.DEEP_BLUE);
    }

    /** 결과 화면의 짧은 라벨과 값을 한 행 또는 카드로 그립니다. @private */
    #resultStat(label, value, rect, color = COLORS.DEEP_BLUE, stacked = false) {
        this.#drawContent({ shape: 'roundRect', ...rect, radius: this.#radius() * .45, fill: 'rgba(95,203,255,0.13)' });
        if (stacked) {
            this.#label(label, rect.x + rect.w / 2, rect.y + rect.h * .28, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { align: 'center', baseline: 'middle', weight: 750, maxWidth: rect.w * .9 });
            this.#label(value, rect.x + rect.w / 2, rect.y + rect.h * .68, this.#size(UI.METRIC_FONT_WH), color, { align: 'center', baseline: 'middle', weight: 950, maxWidth: rect.w * .9 });
            return;
        }
        this.#label(label, rect.x + rect.w * .04, rect.y + rect.h / 2, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { baseline: 'middle', weight: 800, maxWidth: rect.w * .58 });
        this.#label(value, rect.x + rect.w * .96, rect.y + rect.h / 2, this.#size(UI.METRIC_FONT_WH), color, { align: 'right', baseline: 'middle', weight: 950, maxWidth: rect.w * .4 });
    }

    /** 조기 종료 확인 모달을 그립니다. @private */
    #modal() {
        const c = this.context;
        this.#drawContent({ shape: 'rect', x: 0, y: 0, w: c.WW, h: c.WH, fill: 'rgba(8,39,61,0.56)', alpha: .78 });
        const rect = c.layout.modal;
        this.#panel(rect, {
            fill: COLORS.GLASS_FILL_STRONG,
            stroke: COLORS.WARNING,
            edgeColor: COLORS.WARNING,
            shadowColor: COLORS.WARNING,
            shadowRadius: 24,
            contentOnly: true,
            lineWidth: 2.5
        });
        this.#label('방송을 조기 종료할까요?', rect.x + rect.w / 2, rect.y + rect.h * .2, this.#size(UI.SUBTITLE_FONT_WH) * 1.15, COLORS.INK, { align: 'center', weight: 950 });
        this.#wrapped('현재 기록으로 결과를 확정하고 진행 중인 이벤트를 종료합니다.', rect.x + rect.w * .12, rect.y + rect.h * .36, rect.w * .76, this.#size(UI.BODY_FONT_WH), COLORS.INK_MUTED, 2, 'center');
        this.#label('ESC 취소', rect.x + rect.w * .91, rect.y + rect.h * .075, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { align: 'right', weight: 750 });
        this.#button(c.modalCancelButton, '계속 방송', COLORS.GLASS_FILL_STRONG, COLORS.DEEP_BLUE, COLORS.DEEP_BLUE);
        this.#button(c.modalConfirmButton, '조기 종료', COLORS.NEGATIVE, COLORS.GLASS_BORDER, COLORS.GLASS_WHITE);
    }

    /** 상태 안내 토스트를 그립니다. @private */
    #toast() {
        const c = this.context;
        if (!c.toastText || c.toastSecondsRemaining <= 0 || c.earlyEndModalOpen) return;
        const font = createFontString({ weight: 850, sizePx: this.#size(UI.BODY_FONT_WH), family: FONT_FAMILY });
        const toastText = this.#displayText(c.toastText, 500);
        const width = Math.min(c.UIWW * .66, Math.max(260, measureText(toastText, font) + 54));
        const rect = { x: c.UIOffsetX + (c.UIWW - width) / 2, y: c.mode === 'live' ? c.WH * .91 : c.WH * .89, w: width, h: Math.max(42, c.WH * .062) };
        const alpha = clamp(c.toastSecondsRemaining * 2, 0, 1);
        this.#drawContent({ shape: 'roundRect', ...rect, radius: 999, fill: COLORS.DARK_GLASS, stroke: COLORS.AQUA, lineWidth: 1.5, alpha });
        this.#label(toastText, rect.x + rect.w / 2, rect.y + rect.h / 2, this.#size(UI.BODY_FONT_WH), COLORS.GLASS_WHITE, { align: 'center', baseline: 'middle', weight: 850, maxWidth: rect.w - 36, alpha });
    }

    /** 상태 게이지를 그립니다. @private */
    #meter(label, value, color, rect, opinion = false) {
        const numeric = number(value);
        const percent = opinion ? clamp((numeric + 100) / 2, 0, 100) : clamp(numeric, 0, 100);
        const shown = opinion ? `${numeric > 0 ? '+' : ''}${Math.round(numeric)}` : `${Math.round(numeric)}%`;
        this.#label(label, rect.x, rect.y + rect.h * .28, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { baseline: 'middle', weight: 800 });
        this.#label(shown, rect.x + rect.w, rect.y + rect.h * .28, this.#size(UI.METRIC_FONT_WH), color, { align: 'right', baseline: 'middle', weight: 950 });
        const bar = { x: rect.x, y: rect.y + rect.h * .58, w: rect.w, h: Math.max(6, rect.h * .16) };
        this.#drawContent({
            shape: 'roundRect', ...bar, radius: 999,
            fill: {
                type: 'linear', x1: 0, y1: bar.y, x2: 0, y2: bar.y + bar.h,
                stops: [
                    { offset: 0, color: 'rgba(5,37,59,0.62)' },
                    { offset: 1, color: 'rgba(22,91,119,0.28)' }
                ]
            },
            stroke: 'rgba(255,255,255,0.42)', lineWidth: 1, alpha: .72
        });
        if (percent > 0) {
            const fillW = Math.max(bar.h, bar.w * percent / 100);
            this.#drawContent({
                shape: 'roundRect', x: bar.x, y: bar.y, w: fillW, h: bar.h, radius: 999,
                fill: color, shadowBlur: 8, shadowColor: color
            });
            this.#drawContent({
                shape: 'roundRect', x: bar.x + 1, y: bar.y + 1, w: Math.max(1, fillW - 2), h: Math.max(1, bar.h * .34), radius: 999,
                fill: COLORS.GLASS_WHITE, alpha: .38
            });
            this.#drawContent({
                shape: 'circle', x: bar.x + fillW - bar.h * .48, y: bar.y + bar.h * .5,
                radius: Math.max(2, bar.h * .23), fill: COLORS.GLASS_WHITE, alpha: .7
            });
        }
    }

    /** 가독성 높은 수평 카운트다운을 그립니다. @private */
    #timer(rect, remaining, maximum, color, label, labelColor = COLORS.GLASS_WHITE) {
        const left = Math.max(0, number(remaining));
        const max = Math.max(.001, number(maximum, left || 1));
        const ratio = clamp(left / max, 0, 1);
        this.#drawContent({
            shape: 'roundRect', ...rect, radius: 999,
            fill: COLORS.DARK_GLASS_SOFT, stroke: 'rgba(255,255,255,0.34)', lineWidth: 1, alpha: .72
        });
        if (ratio > 0) {
            const fillW = Math.max(rect.h, rect.w * ratio);
            this.#drawContent({
                shape: 'roundRect', x: rect.x, y: rect.y, w: fillW, h: rect.h, radius: 999,
                fill: color, shadowBlur: 9, shadowColor: color
            });
            this.#drawContent({
                shape: 'roundRect', x: rect.x + 1, y: rect.y + 1, w: Math.max(1, fillW - 2), h: Math.max(1, rect.h * .3), radius: 999,
                fill: COLORS.GLASS_WHITE, alpha: .4
            });
        }
        this.#label(`${label} · ${Math.ceil(left)}초${this.context.inputClassificationPending ? ' · PAUSE' : ''}`, rect.x + rect.w, rect.y - Math.max(5, rect.h * .55), this.#size(UI.SMALL_FONT_WH), labelColor, { align: 'right', baseline: 'bottom', weight: 900, maxWidth: rect.w });
    }

    /** 풀링 버튼 상태를 사용자 정의 Canvas 버튼으로 그립니다. @private */
    #button(button, label, fill, stroke, textColor, disabled = false) {
        if (!button?.visible) return;
        const rect = this.#buttonRect(button);
        const radius = Math.min(this.#radius() * .65, rect.h * .32);
        const hover = disabled ? 0 : clamp(button.hoverValue, 0, 1);
        this.#drawContent({
            shape: 'roundRect', ...rect, radius,
            fill: disabled ? COLORS.DARK_GLASS_SOFT : fill,
            stroke,
            lineWidth: 1.5,
            alpha: disabled ? .45 : .96,
            shadowBlur: disabled ? 0 : 4 + hover * 12,
            shadowColor: stroke
        });
        if (!disabled) {
            this.#drawContent({
                shape: 'roundRect',
                x: rect.x + 2,
                y: rect.y + 2,
                w: Math.max(1, rect.w - 4),
                h: Math.max(2, rect.h * .38),
                radius: Math.max(2, radius - 2),
                fill: {
                    type: 'linear', x1: 0, y1: rect.y, x2: 0, y2: rect.y + rect.h * .38,
                    stops: [
                        { offset: 0, color: 'rgba(255,255,255,0.68)' },
                        { offset: 1, color: 'rgba(255,255,255,0)' }
                    ]
                },
                alpha: .48 + hover * .22
            });
        }
        this.#label(label, rect.x + rect.w / 2, rect.y + rect.h / 2, Math.min(this.#size(UI.BODY_FONT_WH), rect.h * .34), textColor, { align: 'center', baseline: 'middle', weight: 900, maxWidth: rect.w * .9, alpha: disabled ? .55 : 1 });
    }

    /** 유리 패널을 그립니다. @private */
    #panel(rect, style = {}) {
        const radius = this.#radius();
        const alpha = style.alpha ?? .96;
        const fill = style.fill || COLORS.GLASS_FILL;
        const stroke = style.stroke || COLORS.GLASS_BORDER;
        const lineWidth = style.lineWidth || 1.2;
        if (!style.contentOnly && this.glassSession?.effectLayerId) {
            this.glassSession.renderGlassPanel({
                x: rect.x,
                y: rect.y,
                w: rect.w,
                h: rect.h,
                radius,
                blur: GLASS_STYLE.BLUR,
                fill,
                stroke,
                lineWidth,
                tintColor: style.tintColor || COLORS.SKY_HAZE || COLORS.GLASS_WHITE,
                edgeColor: style.edgeColor || COLORS.GLASS_HIGHLIGHT || COLORS.GLASS_WHITE,
                tintStrength: style.tintStrength ?? GLASS_STYLE.TINT_STRENGTH,
                edgeStrength: style.edgeStrength ?? GLASS_STYLE.EDGE_STRENGTH,
                refractionStrength: style.refractionStrength ?? GLASS_STYLE.REFRACTION_STRENGTH,
                shadowRadius: style.shadowRadius ?? GLASS_STYLE.SHADOW_RADIUS,
                shadowColor: style.shadowColor || COLORS.GLASS_SHADOW,
                shadowOffsetY: style.shadowOffsetY ?? GLASS_STYLE.SHADOW_OFFSET_Y,
                alpha
            });
        } else {
            this.#drawContent({
                shape: 'roundRect', ...rect, radius, fill, stroke, lineWidth, alpha,
                shadowBlur: style.shadowRadius ?? GLASS_STYLE.SHADOW_RADIUS,
                shadowColor: style.shadowColor || COLORS.GLASS_SHADOW
            });
        }
        if (style.contentTint) {
            this.#drawContent({
                shape: 'roundRect', ...rect, radius,
                fill: style.contentTint,
                alpha
            });
        }
        const inset = Math.max(2, lineWidth + 1);
        this.#drawContent({
            shape: 'roundRect',
            x: rect.x + inset,
            y: rect.y + inset,
            w: Math.max(1, rect.w - inset * 2),
            h: Math.max(1, rect.h - inset * 2),
            radius: Math.max(2, radius - inset),
            fill: false,
            stroke: style.innerStroke || COLORS.GLASS_INNER_EDGE || 'rgba(104,224,255,0.28)',
            lineWidth: 1,
            alpha: alpha * .74
        });
        this.#drawContent({
            shape: 'roundRect',
            x: rect.x + inset + 1,
            y: rect.y + inset + 1,
            w: Math.max(1, rect.w - (inset + 1) * 2),
            h: Math.max(4, Math.min(rect.h * .17, 34)),
            radius: Math.max(2, radius - inset - 1),
            fill: {
                type: 'linear', x1: 0, y1: rect.y, x2: 0, y2: rect.y + Math.max(8, rect.h * .17),
                stops: [
                    { offset: 0, color: COLORS.GLASS_HIGHLIGHT || 'rgba(255,255,255,0.7)' },
                    { offset: 1, color: 'rgba(255,255,255,0)' }
                ]
            },
            alpha: alpha * .55
        });
    }

    /** 모델 템플릿을 로컬 닉네임으로 치환하고 이전 UI 용어를 사용자 표현으로 정리합니다. @private */
    #displayText(value, maxChars = 600) {
        const playerName = text(this.context?.playerName || '플레이어', 24) || '플레이어';
        return text(
            resolveAeroLivePlayerNameTemplate(value, playerName),
            maxChars
        )
            .replace(/가면 계정/gu, playerName)
            .replace(/위장 채팅/gu, '플레이어 채팅');
    }

    /** 한 줄 Canvas 텍스트를 폭에 맞춰 그립니다. @private */
    #label(value, x, y, size, color, options = {}) {
        const font = createFontString({ weight: options.weight || 600, sizePx: size, family: FONT_FAMILY });
        const safe = this.#displayText(value, 500);
        const shown = Number.isFinite(options.maxWidth)
            ? truncateTextToWidth(safe, { maxWidth: options.maxWidth, measureWidth: (candidate) => measureText(candidate, font), ellipsis: '…' })
            : safe;
        this.#drawContent({
            shape: 'text', text: shown, x, y, font, fill: color, align: options.align || 'left',
            baseline: options.baseline || 'top', alpha: options.alpha ?? 1, clipRect: options.clipRect,
            shadowBlur: options.shadowBlur,
            shadowColor: options.shadowColor
        });
    }

    /** 여러 줄 Canvas 텍스트를 문자 단위로 감싸 그립니다. @private */
    #wrapped(value, x, y, width, size, color, maxLines = 3, align = 'left') {
        const font = createFontString({ weight: 750, sizePx: size, family: FONT_FAMILY });
        const lines = wrapTextByCharacters(this.#displayText(value, 600), { maxWidth: width, maxLines, measureWidth: (candidate) => measureText(candidate, font) });
        lines.forEach((line, index) => this.#label(line, align === 'center' ? x + width / 2 : x, y + index * size * 1.28, size, color, { align, weight: 750, maxWidth: width }));
    }

    /** 세로 원본의 머리부터 허리 부근까지를 방송 화면 비율에 맞춰 중앙 크롭합니다. @private */
    #imageUpperBody(rect, image) {
        const sourceW = Math.max(1, number(image.naturalWidth || image.width, 1));
        const sourceH = Math.max(1, number(image.naturalHeight || image.height, 1));
        const targetAspect = Math.max(.1, rect.w / Math.max(1, rect.h));
        const upperTop = sourceH * .03;
        const upperHeight = sourceH * .49;
        let cropW = sourceW;
        let cropH = cropW / targetAspect;
        if (cropH > upperHeight) {
            cropH = upperHeight;
            cropW = Math.min(sourceW, cropH * targetAspect);
        }
        const cropX = (sourceW - cropW) / 2;
        this.#drawContent({
            shape: 'image',
            image,
            sx: cropX,
            sy: upperTop,
            sw: cropW,
            sh: cropH,
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            smoothing: true,
            clipRect: rect
        });
    }

    /** 버튼의 눌림 스케일을 반영한 사각형을 반환합니다. @private */
    #buttonRect(button) {
        const scale = number(button?.scale, 1);
        const w = button.width * scale;
        const h = button.height * scale;
        return { x: button.x + (button.width - w) / 2, y: button.y + (button.height - h) / 2, w, h };
    }

    /** WH 백분율 폰트 크기를 내부 픽셀로 바꿉니다. @private */
    #size(percent) {
        return Math.max(9, this.context.WH * number(percent, 1.5) / 100);
    }

    /** 현재 화면 비율의 공통 패널 반경을 반환합니다. @private */
    #radius() {
        return Math.max(8, this.context.WH * UI.PANEL_RADIUS_WH / 100);
    }
}
