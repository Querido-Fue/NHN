import { getData } from 'data/data_handler.js';
import {
    getCanvasOffset,
    getDisplaySystem,
    getScaleRatio,
    measureText,
    render
} from 'display/display_system.js';
import { OverlaySession } from 'overlay/_overlay_session.js';
import { getSetting } from 'save/save_system.js';
import { createFontString, truncateTextToWidth, wrapTextByCharacters } from 'util/font_util.js';
import { buildVisibleChatRows } from './_aero_live_chat_layout.mjs';
import {
    getAeroLiveHeroAnimationFrame,
    resolveAeroLiveHeroPose
} from './_aero_live_hero_animation.mjs';
import { resolveAeroLivePlayerNameTemplate } from './_aero_live_player_identity.mjs';
import { AeroLiveWallpaperEffectPass } from './_aero_live_wallpaper_effect_pass.js';

const AERO_CONSTANTS = getData('AERO_LIVE_SCENE_CONSTANTS');
const UI = AERO_CONSTANTS.UI;
const COLORS = AERO_CONSTANTS.COLORS;
const WALLPAPER = AERO_CONSTANTS.ASSET.WALLPAPER || {};
const LIVE_STAGE_BACKGROUND_PATH = AERO_CONSTANTS.ASSET.LIVE_STAGE_BACKGROUND_PATH || '';
const DONATION_ALERT_GIF_PATH = AERO_CONSTANTS.ASSET.DONATION_ALERT_GIF_PATH || '';
const HERO_POSE_PATHS = AERO_CONSTANTS.ASSET.HERO_POSE_PATHS || {};
const HERO_EXPRESSION_POSES = AERO_CONSTANTS.ASSET.HERO_EXPRESSION_POSES || {};
const HERO_FALLBACK_POSE = AERO_CONSTANTS.ASSET.HERO_FALLBACK_POSE || 'neutral';
const FONT_FAMILY = 'Pretendard Variable, arial';
const CONJOINING_JAMO_PATTERN = /[\u1100-\u1112\u1161-\u1175]/gu;
const COMPATIBILITY_JAMO_BY_CONJOINING = Object.freeze({
    'ᄀ': 'ㄱ', 'ᄁ': 'ㄲ', 'ᄂ': 'ㄴ', 'ᄃ': 'ㄷ', 'ᄄ': 'ㄸ', 'ᄅ': 'ㄹ',
    'ᄆ': 'ㅁ', 'ᄇ': 'ㅂ', 'ᄈ': 'ㅃ', 'ᄉ': 'ㅅ', 'ᄊ': 'ㅆ', 'ᄋ': 'ㅇ',
    'ᄌ': 'ㅈ', 'ᄍ': 'ㅉ', 'ᄎ': 'ㅊ', 'ᄏ': 'ㅋ', 'ᄐ': 'ㅌ', 'ᄑ': 'ㅍ', 'ᄒ': 'ㅎ',
    'ᅡ': 'ㅏ', 'ᅢ': 'ㅐ', 'ᅣ': 'ㅑ', 'ᅤ': 'ㅒ', 'ᅥ': 'ㅓ', 'ᅦ': 'ㅔ',
    'ᅧ': 'ㅕ', 'ᅨ': 'ㅖ', 'ᅩ': 'ㅗ', 'ᅪ': 'ㅘ', 'ᅫ': 'ㅙ', 'ᅬ': 'ㅚ',
    'ᅭ': 'ㅛ', 'ᅮ': 'ㅜ', 'ᅯ': 'ㅝ', 'ᅰ': 'ㅞ', 'ᅱ': 'ㅟ', 'ᅲ': 'ㅠ',
    'ᅳ': 'ㅡ', 'ᅴ': 'ㅢ', 'ᅵ': 'ㅣ'
});
const TOPIC_ACCENTS = Object.freeze(['#42E0D0', '#62D65B', '#FFD65A', '#FF8AA1', '#7B9CFF']);
const CORE_COLORS = Object.freeze({
    kick: COLORS.NEGATIVE,
    delete: COLORS.WARNING,
    ignore: COLORS.NEUTRAL
});
const GLASS_STYLE = Object.freeze({
    BLUR: 20,
    TINT_STRENGTH: 0.12,
    EDGE_STRENGTH: 0.26,
    REFRACTION_STRENGTH: 2,
    SHADOW_RADIUS: 9,
    SHADOW_OFFSET_Y: 4
});
const DONATION_ALERT_SECONDS = Math.max(
    1,
    Number(AERO_CONSTANTS.UI?.DONATION_ALERT_SECONDS) || 5.5
);
const TOP_BAR_TIMER_COLOR = '#28566E';
const TOP_BAR_STAT_LABEL_COLOR = 'rgba(245,254,255,0.86)';
const DISPLAY_VIEWER_MULTIPLIER = 3;
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
        .replace(CONJOINING_JAMO_PATTERN, (jamo) => COMPATIBILITY_JAMO_BY_CONJOINING[jamo] || jamo)
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
 * 시청자 수는 연출용으로만 세 배 확대해 표기합니다.
 * 런타임 지표와 판정에는 원본 값을 계속 사용합니다.
 * @param {*} value - 원본 시청자 수입니다.
 * @returns {string} 확대된 시청자 수 문자열입니다.
 */
function displayedViewerCount(value) {
    return integer(number(value) * DISPLAY_VIEWER_MULTIPLIER);
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
     * 라이브 배경과 히로인 pose 이미지를 경로별로 한 번씩 미리 불러옵니다.
     */
    constructor() {
        this.destroyed = false;
        this.glassSession = null;
        this.glassSessionInitialized = false;
        this.tutorialGlassSession = null;
        this.tutorialGlassSessionInitialized = false;
        this.lastBackdropRevision = '';
        this.contentLayer = 'ui';
        this.wallpaperEffectPass = null;
        this.wallpaperRenderedThisFrame = false;
        this.wallpaperAssetRecords = [];
        this.wallpaperAssets = {};
        this.liveStageBackground = {
            path: LIVE_STAGE_BACKGROUND_PATH,
            image: null,
            ready: false,
            failed: false
        };
        this.liveStageBackgroundRenderedThisFrame = false;
        this.donationAlertAsset = {
            path: DONATION_ALERT_GIF_PATH,
            image: null,
            ready: false,
            failed: !DONATION_ALERT_GIF_PATH
        };
        this.donationAlertEventKey = '';
        this.donationAlertStartedAt = 0;
        this.donationAlertDomGif = null;
        this.donationAlertDomGifEventKey = '';
        this.donationAlertDomGifFailed = false;
        this.tutorialVignetteCanvas = null;
        this.tutorialVignetteContext = null;
        this.tutorialVignetteSignature = '';
        this.disableTransparency = typeof getSetting === 'function'
            && getSetting('disableTransparency') === true;
        this.heroReady = false;
        this.heroFailed = false;
        this.heroPoses = new Map();
        this.heroAssetRecords = [];
        this.heroSemanticPose = null;
        this.heroSemanticPoseChangedAt = 0;
        this.heroBeatId = '';
        this.heroBeatChangedAt = 0;
        this.heroResponseKey = '';
        this.heroResponseChangedAt = 0;
        this.heroEventKey = '';
        this.heroEventChangedAt = 0;
        this.lastDrawMode = null;
        this.heroVisualStatus = null;
        const recordsByPath = new Map();
        const pendingLoads = [];
        const wallpaperLoads = [];

        const wallpaperPaths = {
            base: WALLPAPER.BASE_PATH,
            normal: WALLPAPER.NORMAL_PATH,
            waterMask: WALLPAPER.WATER_MASK_PATH,
            cursorMask: WALLPAPER.CURSOR_MASK_PATH
        };
        for (const [key, rawPath] of Object.entries(wallpaperPaths)) {
            const path = String(rawPath || '').trim();
            const record = {
                key,
                path,
                image: null,
                ready: false,
                failed: false
            };
            this.wallpaperAssetRecords.push(record);
            this.wallpaperAssets[key] = record;
            if (!path) {
                record.failed = true;
                continue;
            }
            const image = new Image();
            record.image = image;
            const loadPromise = new Promise((resolve) => {
                const settle = (ready) => {
                    if (record.ready || record.failed) return;
                    record.ready = ready;
                    record.failed = !ready;
                    this.lastBackdropRevision = '';
                    resolve();
                };
                image.onload = () => settle(true);
                image.onerror = () => settle(false);
            });
            pendingLoads.push(loadPromise);
            wallpaperLoads.push(loadPromise);
            image.src = path;
        }

        if (LIVE_STAGE_BACKGROUND_PATH) {
            const image = new Image();
            const record = this.liveStageBackground;
            record.image = image;
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
            image.src = LIVE_STAGE_BACKGROUND_PATH;
        } else {
            this.liveStageBackground.failed = true;
        }

        for (const [rawPose, rawPath] of Object.entries(HERO_POSE_PATHS)) {
            const pose = String(rawPose || '').trim().toLowerCase();
            const path = String(rawPath || '').trim();
            if (!pose || !path) continue;

            let record = recordsByPath.get(path);
            if (!record) {
                const image = new Image();
                record = {
                    path,
                    image,
                    ready: false,
                    failed: false,
                    poses: []
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
            record.poses.push(pose);
            this.heroPoses.set(pose, record);
        }

        this.wallpaperReadyPromise = Promise.all(wallpaperLoads).then(() => {
            if (this.destroyed) return;
            this.#ensureWallpaperEffectPass();
        });
        this.readyPromise = Promise.all(pendingLoads).then(() => {
            if (this.destroyed) return;
            this.#refreshHeroLoadState();
            this.#ensureWallpaperEffectPass();
        });
    }

    /**
     * wallpaper 네 장, 라이브 stage 배경과 히로인 이미지의 로드 성공 또는 실패가 확정될 때까지 기다립니다.
     * @returns {Promise<void>} 이미지 로드 완료 Promise입니다.
     */
    whenReady() {
        const heroSettled = this.heroReady || this.heroFailed;
        const wallpaperSettled = this.wallpaperAssetRecords.every((record) => record.ready || record.failed);
        const liveStageSettled = this.liveStageBackground.ready || this.liveStageBackground.failed;
        return this.destroyed || (heroSettled && wallpaperSettled && liveStageSettled)
            ? Promise.resolve()
            : this.readyPromise;
    }

    /**
     * NW 스모크와 진단에서 wallpaper asset·shader·simulation·blur 상태를 확인합니다.
     * @returns {object} wallpaper effect 진단 스냅샷입니다.
     */
    getWallpaperEffectStatus() {
        const assets = this.wallpaperAssetRecords.map((record) => ({
            key: record.key,
            src: record.image?.src || record.path || '',
            ready: record.ready === true,
            failed: record.failed === true,
            naturalWidth: record.image?.naturalWidth || 0,
            naturalHeight: record.image?.naturalHeight || 0
        }));
        const effectStatus = this.wallpaperEffectPass?.getStatus?.() || {};
        const overlayMetrics = this.glassSession?.getEffectMetrics?.() || null;
        return {
            ...effectStatus,
            ready: effectStatus.ready === true,
            failed: effectStatus.failed === true
                || this.wallpaperAssets.base?.failed === true,
            assets,
            assetMap: effectStatus.assets || {},
            passes: {
                ...(effectStatus.passes || {}),
                lastOrder: Array.isArray(overlayMetrics?.lastBackdropPassOrder)
                    ? [...overlayMetrics.lastBackdropPassOrder]
                    : []
            },
            renderedThisFrame: this.wallpaperRenderedThisFrame,
            blur: {
                sourceCount: overlayMetrics?.blurSourceCount || 0,
                canvasUploads: overlayMetrics?.canvasUploads || 0,
                refreshCount: overlayMetrics?.blurRefreshes || 0,
                backdropFrameSerial: overlayMetrics?.backdropFrameSerial ?? -1,
                sampledBackdropFrameSerial: overlayMetrics?.sampledBackdropFrameSerial ?? -1
            },
            overlay: overlayMetrics
        };
    }

    /** 이전 smoke 소비자용 호환 alias입니다. @returns {object} wallpaper 진단입니다. */
    getLiveBackdropAssetStatus() {
        return this.getWallpaperEffectStatus();
    }

    /**
     * 기존 방송 studio 배경 에셋의 로드 상태를 반환합니다.
     * @returns {{ready:boolean,failed:boolean,renderedThisFrame:boolean,src:string,naturalWidth:number,naturalHeight:number}}
     */
    getLiveStageBackgroundAssetStatus() {
        const record = this.liveStageBackground || {};
        return {
            ready: record.ready === true,
            failed: record.failed === true,
            renderedThisFrame: this.liveStageBackgroundRenderedThisFrame === true,
            src: record.image?.src || record.path || '',
            naturalWidth: record.image?.naturalWidth || 0,
            naturalHeight: record.image?.naturalHeight || 0
        };
    }

    /**
     * 실행 중 변경된 투명도 설정을 AERO 전용 overlay session에 전달합니다.
     * @param {object} [changedSettings={}] - 변경된 런타임 설정입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        if (changedSettings.disableTransparency === undefined) {
            return;
        }
        this.disableTransparency = changedSettings.disableTransparency === true;
        this.glassSession?.setDisableTransparency?.(this.disableTransparency);
        this.lastBackdropRevision = '';
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
                poses: [...record.poses],
                expressions: [...record.poses],
                src: record.image?.src || record.path,
                ready: record.ready,
                failed: record.failed,
                naturalWidth: record.image?.naturalWidth || 0,
                naturalHeight: record.image?.naturalHeight || 0
            })),
            activeVisual: this.heroVisualStatus
                ? {
                    ...this.heroVisualStatus,
                    motion: { ...this.heroVisualStatus.motion }
                }
                : null
        };
    }

    /**
     * 현재 Scene 표현 컨텍스트를 Canvas에 그립니다.
     * @param {object} context - Scene이 제공하는 읽기 전용 표현 상태입니다.
     */
    draw(context) {
        if (this.destroyed || !context) return;
        this.context = context;
        const previousMode = this.lastDrawMode;
        this.lastDrawMode = context.mode;
        if (context.mode === 'live' && previousMode !== 'live') {
            this.#resetHeroMotionTimeline(context.elapsedVisualSeconds);
            this.#resetDonationAlertTimeline(context.elapsedVisualSeconds);
        } else if (context.mode !== 'live') {
            this.#hideDonationAlertDomGif();
        }
        this.liveStageBackgroundRenderedThisFrame = false;
        this.#ensureGlassSession();
        this.#backdrop();
        this.#syncGlassBackdropRevision();
        if (context.mode === 'nickname') this.#nickname();
        else if (context.mode === 'topicSelect') this.#topics();
        else if (context.mode === 'results') this.#results();
        else this.#live();
        this.#toast();
        if (context.earlyEndModalOpen) this.#modal();
        if (context.tutorial?.active) this.#tutorial();
        else this.#releaseTutorialGlassSession();
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
        this.heroPoses.clear();
        this.heroAssetRecords = [];
        this.heroReady = false;
        this.heroFailed = false;
        this.heroSemanticPose = null;
        this.heroSemanticPoseChangedAt = 0;
        this.heroBeatId = '';
        this.heroBeatChangedAt = 0;
        this.heroResponseKey = '';
        this.heroResponseChangedAt = 0;
        this.heroEventKey = '';
        this.heroEventChangedAt = 0;
        this.lastDrawMode = null;
        this.heroVisualStatus = null;
        for (const record of this.wallpaperAssetRecords) {
            if (record.image) {
                record.image.onload = null;
                record.image.onerror = null;
            }
            record.image = null;
        }
        this.wallpaperEffectPass?.destroy?.();
        this.wallpaperEffectPass = null;
        this.wallpaperAssetRecords = [];
        this.wallpaperAssets = {};
        this.wallpaperRenderedThisFrame = false;
        if (this.liveStageBackground?.image) {
            this.liveStageBackground.image.onload = null;
            this.liveStageBackground.image.onerror = null;
        }
        this.liveStageBackground = {
            path: LIVE_STAGE_BACKGROUND_PATH,
            image: null,
            ready: false,
            failed: true
        };
        this.liveStageBackgroundRenderedThisFrame = false;
        this.#disposeDonationAlertDomGif();
        this.tutorialVignetteCanvas = null;
        this.tutorialVignetteContext = null;
        this.tutorialVignetteSignature = '';
        if (this.donationAlertAsset?.image) {
            this.donationAlertAsset.image.onload = null;
            this.donationAlertAsset.image.onerror = null;
        }
        this.donationAlertAsset = {
            path: DONATION_ALERT_GIF_PATH,
            image: null,
            ready: false,
            failed: true
        };
        this.donationAlertEventKey = '';
        this.donationAlertStartedAt = 0;
        this.glassSession?.release?.();
        this.glassSession = null;
        this.glassSessionInitialized = true;
        this.#releaseTutorialGlassSession();
        this.lastBackdropRevision = '';
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

    /** 튜토리얼 카드가 이미 그려진 방송 UI 전체를 안전하게 블러할 상위 glass surface를 만듭니다. @private */
    #ensureTutorialGlassSession() {
        if (this.tutorialGlassSessionInitialized || this.destroyed) {
            return this.tutorialGlassSession;
        }
        this.tutorialGlassSessionInitialized = true;
        this.tutorialGlassSession = this.#createGlassSession({
            layer: 1,
            orderSequence: 0,
            blurUpdateMode: 'always'
        });
        return this.tutorialGlassSession;
    }

    /** 튜토리얼이 끝났을 때 상위 glass surface를 반환합니다. @private */
    #releaseTutorialGlassSession() {
        this.tutorialGlassSession?.release?.();
        this.tutorialGlassSession = null;
        this.tutorialGlassSessionInitialized = false;
    }

    /** wallpaper asset이 settle된 뒤 scene 전용 GPU pass를 한 번만 준비합니다. @private */
    #ensureWallpaperEffectPass() {
        if (this.wallpaperEffectPass || this.destroyed) {
            return;
        }
        const assetsSettled = this.wallpaperAssetRecords.every((record) => record.ready || record.failed);
        if (!assetsSettled) {
            return;
        }
        const baseRecord = this.wallpaperAssets.base;
        if (!baseRecord?.ready || !baseRecord.image) {
            return;
        }
        try {
            this.wallpaperEffectPass = new AeroLiveWallpaperEffectPass({
                assets: Object.fromEntries(Object.entries(this.wallpaperAssets).map(([key, record]) => [
                    key,
                    record?.ready ? record.image : null
                ])),
                parameters: WALLPAPER
            });
        } catch {
            this.wallpaperEffectPass = null;
        }
    }

    /** 후원 발생 때만 재생할 GIF를 한 번 불러옵니다. @private */
    #ensureDonationAlertAsset() {
        const record = this.donationAlertAsset;
        if (this.destroyed
            || !record?.path
            || record.image
            || record.ready
            || record.failed) {
            return;
        }
        try {
            const image = new Image();
            record.image = image;
            const settle = (ready) => {
                if (this.destroyed || record.ready || record.failed) {
                    return;
                }
                record.ready = ready;
                record.failed = !ready;
            };
            image.onload = () => settle(true);
            image.onerror = () => settle(false);
            image.src = record.path;
        } catch {
            record.failed = true;
        }
    }

    /** wallpaper animation을 지정 주기로 양자화해 공유 blur texture만 저빈도로 갱신합니다. @private */
    #syncGlassBackdropRevision() {
        if (!this.wallpaperRenderedThisFrame || !this.glassSession?.isGlassEnabled?.()) {
            return;
        }
        const c = this.context || {};
        const effectStatus = this.wallpaperEffectPass?.getStatus?.() || {};
        const refreshHz = Math.max(1, number(WALLPAPER.BLUR_REFRESH_HZ, 10));
        const bucket = Math.floor(Math.max(0, number(c.elapsedVisualSeconds)) * refreshHz);
        const revision = [
            effectStatus.mode || 'static',
            number(effectStatus.resourceRevision),
            Math.round(number(c.WW)),
            Math.round(number(c.WH)),
            bucket
        ].join(':');
        if (revision === this.lastBackdropRevision) {
            return;
        }
        this.lastBackdropRevision = revision;
        this.glassSession.invalidateBlur();
    }

    /** 실제 backdrop을 샘플링하는 전용 glass/effect 및 선명한 2D content surface를 만듭니다. @private */
    #createGlassSession({ layer = 0, orderSequence = 0, blurUpdateMode = 'dirty' } = {}) {
        const displaySystem = typeof getDisplaySystem === 'function' ? getDisplaySystem() : null;
        if (!displaySystem || typeof OverlaySession !== 'function') {
            return null;
        }
        try {
            return new OverlaySession({
                displaySystem,
                layer,
                dim: 0,
                transparent: true,
                glOverlay: true,
                blurUpdateMode,
                effects: {},
                orderSequence,
                disableTransparency: this.disableTransparency
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

    /** 요청 frame, 의미 pose, 기본 pose, 첫 성공 에셋 순으로 안전한 레코드를 반환합니다. @private */
    #heroRecordForPose(value, semanticPose = HERO_FALLBACK_POSE) {
        const pose = String(value || '').trim().toLowerCase();
        const requested = this.heroPoses.get(pose);
        if (requested?.ready && requested.image) return requested;
        const semanticFallback = this.heroPoses.get(String(semanticPose || '').trim().toLowerCase());
        if (semanticFallback?.ready && semanticFallback.image) return semanticFallback;
        const fallback = this.heroPoses.get(HERO_FALLBACK_POSE);
        if (fallback?.ready && fallback.image) return fallback;
        return this.heroAssetRecords.find((record) => record.ready && record.image) || null;
    }

    /** 이식한 WebGL wallpaper 또는 안전한 정적·절차식 폴백 backdrop을 그립니다. @private */
    #backdrop() {
        const c = this.context;
        this.wallpaperRenderedThisFrame = false;
        this.#ensureWallpaperEffectPass();
        if (this.wallpaperEffectPass && this.glassSession?.effectLayerId) {
            this.wallpaperRenderedThisFrame = this.glassSession.renderBackdropEffect({
                effectPass: this.wallpaperEffectPass,
                elapsedSeconds: Math.max(0, number(c.elapsedVisualSeconds)),
                deltaSeconds: Math.max(0, number(c.deltaVisualSeconds)),
                pointer: c.wallpaperPointer || null,
                viewport: c.layout?.backdrop || {
                    x: 0,
                    y: 0,
                    w: c.WW,
                    h: c.WH
                }
            });
            if (this.wallpaperRenderedThisFrame) {
                return;
            }
        }

        const baseRecord = this.wallpaperAssets.base;
        if (baseRecord?.ready && baseRecord.image) {
            render('ui', {
                shape: 'rect',
                x: 0,
                y: 0,
                w: c.WW,
                h: c.WH,
                fill: COLORS.SKY_HAZE || '#E8FCFF'
            });
            render('ui', {
                shape: 'image',
                image: baseRecord.image,
                sx: 0,
                sy: 0,
                sw: Math.max(1, number(baseRecord.image.naturalWidth || baseRecord.image.width, 1920)),
                sh: Math.max(1, number(baseRecord.image.naturalHeight || baseRecord.image.height, 1080)),
                x: c.layout?.backdrop?.x ?? c.UIOffsetX,
                y: c.layout?.backdrop?.y ?? 0,
                w: c.layout?.backdrop?.w ?? c.UIWW,
                h: c.layout?.backdrop?.h ?? c.WH,
                smoothing: true
            });
            return;
        }
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
                shadowBlur: index === 2 ? 14 : 0,
                shadowColor: 'rgba(255,246,190,0.46)'
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
                shadowBlur: Math.max(4, 9 * scale),
                shadowColor: 'rgba(210,246,255,0.3)'
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
            shadowBlur: Math.max(2, radius * .08),
            shadowColor: 'rgba(245,254,255,0.5)'
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
            shadowBlur: Math.max(2, radius * .08),
            shadowColor: index % 2 === 0 ? 'rgba(71,216,255,0.12)' : 'rgba(255,134,215,0.12)'
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
            shadowBlur: 4,
            shadowColor: 'rgba(66,224,208,0.24)'
        });
        this.#panel(rect, {
            fill: COLORS.GLASS_FILL_STRONG,
            stroke: c.nicknameInvalid ? COLORS.NEGATIVE : COLORS.GLASS_BORDER,
            edgeColor: c.nicknameInvalid ? COLORS.NEGATIVE : COLORS.GLASS_HIGHLIGHT,
            tintColor: COLORS.AQUA,
            tintStrength: .07,
            edgeStrength: c.nicknameInvalid ? .34 : .18,
            lineWidth: c.nicknameInvalid ? 2 : 1.4,
            shadowColor: COLORS.GLASS_SHADOW,
            shadowRadius: c.nicknameInvalid ? 10 : 6
        });
        this.#label(
            '방송에서 사용할 닉네임을 정해 주세요',
            rect.x + rect.w / 2,
            rect.y + rect.h * .17,
            this.#size(UI.SUBTITLE_FONT_WH) * 1.08,
            COLORS.INK,
            { align: 'center', weight: 950, maxWidth: rect.w * .86 }
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
            align: 'center', weight: 950, shadowBlur: 4, shadowColor: 'rgba(66,224,208,0.24)'
        });
        this.#label(
            `${c.playerName || '플레이어'}님, 오늘 방송 주제를 선택해 주세요`,
            center,
            c.WH * .17,
            this.#size(UI.BODY_FONT_WH),
            COLORS.INK,
            { align: 'center', weight: 850, maxWidth: c.UIWW * .72 }
        );

        c.topicButtons.forEach((button, index) => {
            const topic = c.topicSummaries[index] || {};
            const rect = this.#buttonRect(button);
            const accent = TOPIC_ACCENTS[index % TOPIC_ACCENTS.length];
            this.#panel(rect, {
                fill: COLORS.GLASS_FILL_STRONG,
                stroke: accent,
                edgeColor: COLORS.GLASS_HIGHLIGHT,
                tintColor: accent,
                tintStrength: .055,
                edgeStrength: .18 + button.hoverValue * .06,
                shadowColor: COLORS.GLASS_SHADOW,
                shadowRadius: 4 + button.hoverValue * 3,
                lineWidth: 1.4 + button.hoverValue * .8
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
                shadowBlur: button.hoverValue * 5,
                shadowColor: accent
            });
            const numberRadius = Math.min(rect.w, rect.h) * .095;
            this.#drawContent({
                shape: 'circle', x: rect.x + rect.w * .16, y: rect.y + rect.h * .28, radius: numberRadius,
                fill: accent, stroke: COLORS.GLASS_BORDER, lineWidth: 1.4,
                shadowBlur: 1 + button.hoverValue * 4, shadowColor: accent
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

    /** 메인·우상 채팅·우하 프로듀서 창으로 방송 화면을 그립니다. @private */
    #live() {
        this.#liveWindows();
        this.#topBar();
        this.#hero();
        this.#chatPanel();
        this.#leftPanel();
    }

    /** baked skin을 대신하는 세 개의 실제 backdrop glass 방송 창을 그립니다. @private */
    #liveWindows() {
        const layout = this.context.layout;
        [
            [layout.mainFrame, 'live-main', COLORS.AERO_PINK || COLORS.SKY_HAZE, .04],
            [layout.chatFrame, 'live-chat', COLORS.AQUA, .05],
            [layout.producerFrame, 'live-producer', COLORS.AERO_VIOLET || COLORS.SKY_HAZE, .045]
        ].forEach(([rect, role, tintColor, tintStrength]) => {
            this.#panel(rect, {
                role,
                fill: 'rgba(235,251,255,0.18)',
                flatFill: 'rgba(235,251,255,0.34)',
                contentTint: 'rgba(245,254,255,0.025)',
                stroke: 'rgba(255,255,255,0.24)',
                innerStroke: 'rgba(255,255,255,0.1)',
                tintColor,
                tintStrength,
                edgeStrength: .14,
                topSheenHeight: Math.max(
                    8 * this.#uiScale(),
                    Math.min(rect.h * .13, 34 * this.#uiScale())
                ),
                topSheenAlpha: .72,
                alpha: .92,
                shadowRadius: 9
            });
        });
    }

    /** 방송 상단 상태 바를 그립니다. @private */
    #topBar() {
        const c = this.context;
        const rect = c.layout.topBar;
        const m = c.snapshot?.metrics || {};
        const pad = c.layout.panelPad;
        if (!this.#usesLiveWindowLayout()) {
            this.#panel(rect, { fill: COLORS.GLASS_FILL_STRONG, tintStrength: .15 });
        }
        const pill = { x: rect.x + pad * .6, y: rect.y + rect.h * .24, w: Math.max(64, rect.h * 1.25), h: rect.h * .52 };
        this.#drawContent({ shape: 'roundRect', ...pill, radius: 999, fill: COLORS.LIVE });
        this.#label('● LIVE', pill.x + pill.w / 2, pill.y + pill.h / 2, this.#size(UI.SMALL_FONT_WH), COLORS.GLASS_WHITE, { align: 'center', baseline: 'middle', weight: 950 });
        const titleX = pill.x + pill.w + pad * .7;
        this.#label(c.snapshot?.topic?.title || 'AERO LIVE', titleX, rect.y + rect.h * .34, this.#size(UI.SUBTITLE_FONT_WH), COLORS.INK, { baseline: 'middle', weight: 950, maxWidth: rect.w * .26 });
        this.#label(clock(c.snapshot?.elapsedSeconds), titleX, rect.y + rect.h * .68, this.#size(UI.SMALL_FONT_WH), TOP_BAR_TIMER_COLOR, { baseline: 'middle', weight: 700 });
        if (this.#usesLiveWindowLayout()) {
            this.#macWindowControls(c.layout.mainWindowControls, c.endButton);
        } else {
            this.#button(c.endButton, '종료', COLORS.DARK_GLASS, COLORS.NEGATIVE, COLORS.GLASS_WHITE);
        }
        const mainFrame = c.layout.mainFrame || rect;
        const leftInset = Math.max(0, pill.x - mainFrame.x);
        const statsRight = mainFrame.x + mainFrame.w - leftInset;
        const statScale = this.#uiScale();
        const statGap = Math.max(6 * statScale, rect.h * .075);
        const desiredStatW = clamp(
            rect.w * .104,
            104 * statScale,
            156 * statScale
        );
        const availableStatW = Math.max(
            1,
            (statsRight - (titleX + rect.w * .16) - statGap * 2) / 3
        );
        const statW = Math.min(
            desiredStatW,
            availableStatW
        );
        const statsPanel = {
            x: statsRight - (statW * 3 + statGap * 2),
            y: rect.y + rect.h * .13,
            w: statW * 3 + statGap * 2,
            h: rect.h * .74
        };
        this.#panel(statsPanel, {
            role: 'live-top-stats',
            fill: 'rgba(8,48,74,0.4)',
            flatFill: 'rgba(8,48,74,0.56)',
            stroke: 'rgba(245,254,255,0.34)',
            edgeColor: 'rgba(245,254,255,0.38)',
            tintColor: COLORS.DEEP_BLUE,
            tintStrength: .045,
            edgeStrength: .12,
            shadowRadius: 0,
            lineWidth: 1
        });
        [['시청자', displayedViewerCount(m.viewers), COLORS.DEEP_BLUE], ['참여도', `${Math.round(number(m.engagement))}%`, COLORS.AQUA], ['수익', `${integer(m.revenue)}원`, COLORS.POSITIVE]].forEach((item, i) => {
            const x = statsPanel.x + i * (statW + statGap);
            this.#label(item[0], x + statW / 2, statsPanel.y + statsPanel.h * .3, this.#size(UI.SMALL_FONT_WH), TOP_BAR_STAT_LABEL_COLOR, {
                align: 'center', baseline: 'middle', weight: 800, maxWidth: statW * .92,
                shadowBlur: 1.5, shadowColor: 'rgba(7,35,59,0.45)'
            });
            this.#label(item[1], x + statW / 2, statsPanel.y + statsPanel.h * .68, this.#size(UI.METRIC_FONT_WH), item[2], { align: 'center', baseline: 'middle', weight: 950, maxWidth: statW * .92 });
        });
    }

    /** 우하 프로듀서 창에 후원 카드, 방송 지표와 여섯 감정 지시를 그립니다. @private */
    #leftPanel() {
        const c = this.context;
        const rect = c.layout.left;
        const m = c.snapshot?.metrics || {};
        const titleRect = this.#usesLiveWindowLayout() && c.layout.producerTitleBar
            ? c.layout.producerTitleBar
            : rect;
        const liveWindowLayout = this.#usesLiveWindowLayout();
        if (!liveWindowLayout) {
            this.#panel(rect, { fill: COLORS.GLASS_FILL, alpha: .92, tintStrength: .16 });
        }
        const producerTitleY = liveWindowLayout
            ? (c.layout.producerWindowControls?.buttons?.[0]?.y ?? titleRect.y + titleRect.h * .53)
            : rect.y + c.layout.panelPad * .68;
        this.#label('프로듀서 콘솔', titleRect.x + c.layout.panelPad * .45, producerTitleY, this.#size(UI.SUBTITLE_FONT_WH), COLORS.INK, { baseline: 'middle', weight: 950 });
        if (liveWindowLayout) {
            this.#macWindowControls(c.layout.producerWindowControls);
        }
        this.#donation();
        const rows = [
            ['스트레스', m.stress, COLORS.NEGATIVE, false],
            ['호감도', m.affection, COLORS.POSITIVE, false],
            ['여론', m.opinion, COLORS.DEEP_BLUE, true],
            ['참여도', m.engagement, COLORS.AQUA, false]
        ];
        const metricRects = Array.isArray(c.layout.metricRects) && c.layout.metricRects.length === rows.length
            ? c.layout.metricRects
            : rows.map((_, index) => {
                const area = c.layout.metricArea;
                return { x: area.x, y: area.y + area.h / 4 * index, w: area.w, h: area.h / 4 };
            });
        rows.forEach((row, index) => this.#meter(row[0], row[1], row[2], metricRects[index], row[3]));
        c.donationButtons.forEach((button) => this.#button(button, button.aeroData?.label || '지시', COLORS.DARK_GLASS, COLORS.AQUA, COLORS.GLASS_WHITE, button.aeroDisabled));
    }

    /** 활성 후원 또는 대기 카드를 그립니다. @private */
    #donation() {
        const c = this.context;
        const d = c.snapshot?.activeDonation;
        const rect = c.layout.donationCard;
        this.#panel(rect, {
            role: 'live-donation',
            fill: d ? 'rgba(255,214,90,0.2)' : COLORS.GLASS_FILL_STRONG,
            stroke: d ? COLORS.WARNING : COLORS.GLASS_BORDER,
            edgeStrength: d ? .22 : .12,
            lineWidth: d ? 1.7 : 1,
            shadowRadius: 0
        });
        if (!d) {
            return;
        }
        this.#label(`${text(d.author, 24)} · ${integer(d.amount)}원`, rect.x + rect.w * .07, rect.y + rect.h * .19, this.#size(UI.BODY_FONT_WH), COLORS.INK, { baseline: 'middle', weight: 950, maxWidth: rect.w * .86 });
        this.#wrapped(d.text, rect.x + rect.w * .07, rect.y + rect.h * .34, rect.w * .86, this.#size(UI.BODY_FONT_WH), COLORS.INK, 2);
        this.#timer({ x: rect.x + rect.w * .07, y: rect.y + rect.h * .81, w: rect.w * .86, h: Math.max(8, rect.h * .08) }, d.timeRemainingSeconds, c.timerMaximums.donation, COLORS.WARNING, '후원', COLORS.INK);
    }

    /** 메인 창의 히로인 스튜디오와 대사를 그립니다. @private */
    #hero() {
        const c = this.context;
        const stage = c.layout.heroStage;
        const dialogue = c.layout.heroDialogue;
        const beat = c.snapshot?.currentBeat || {};
        const activeDonation = c.snapshot?.activeDonation;
        const coreResponsePending = !!c.snapshot?.activeCoreChat;
        const activeExpression = c.heroResponseText
            ? (c.heroResponseExpression || beat.expression)
            : beat.expression;
        const visualSeconds = Math.max(0, number(c.elapsedVisualSeconds));
        const semanticPose = resolveAeroLiveHeroPose({
            topicId: c.snapshot?.topic?.id,
            expression: activeExpression,
            expressionPoses: HERO_EXPRESSION_POSES
        });
        if (semanticPose !== this.heroSemanticPose) {
            this.heroSemanticPose = semanticPose;
            this.heroSemanticPoseChangedAt = visualSeconds;
        }
        const motionProfile = this.#resolveHeroMotionProfile(beat, semanticPose, visualSeconds);
        const animationFrame = getAeroLiveHeroAnimationFrame({
            pose: semanticPose,
            elapsedSeconds: visualSeconds,
            poseAgeSeconds: visualSeconds - this.heroSemanticPoseChangedAt,
            motionState: motionProfile.state,
            motionStateAgeSeconds: motionProfile.ageSeconds,
            emotion: activeExpression
        });
        const heroRecord = this.#heroRecordForPose(animationFrame.assetKey, semanticPose);
        const heroImage = heroRecord?.image || null;
        this.heroVisualStatus = {
            topicId: c.snapshot?.topic?.id || null,
            beatId: beat.id || null,
            expression: String(activeExpression || ''),
            pose: semanticPose,
            assetKey: animationFrame.assetKey,
            motionState: animationFrame.motionState,
            motionStateAgeSeconds: motionProfile.ageSeconds,
            resolvedPoses: heroRecord ? [...heroRecord.poses] : [],
            src: heroRecord?.image?.src || heroRecord?.path || '',
            motion: { ...animationFrame.motion }
        };
        const liveWindowLayout = this.#usesLiveWindowLayout();
        if (liveWindowLayout) {
            this.#panel(stage, {
                role: 'live-stage',
                fill: 'rgba(7,35,59,0.18)',
                stroke: 'rgba(255,255,255,0.5)',
                edgeColor: COLORS.GLASS_HIGHLIGHT,
                tintColor: COLORS.AERO_PINK || COLORS.SKY_HAZE,
                tintStrength: .04,
                edgeStrength: .16,
                alpha: .78,
                shadowRadius: 0
            });
            this.#drawLiveStageBackground(stage);
        } else {
            this.#panel(c.layout.center, { fill: COLORS.GLASS_FILL, alpha: .89, tintColor: COLORS.AERO_PINK || COLORS.SKY_HAZE, tintStrength: .07 });
            this.#drawContent({
                shape: 'roundRect',
                x: stage.x - 2, y: stage.y - 2, w: stage.w + 4, h: stage.h + 4,
                radius: this.#radius() + 2,
                fill: 'rgba(255,255,255,0.14)',
                stroke: COLORS.AQUA,
                lineWidth: 2,
                shadowBlur: 5,
                shadowColor: 'rgba(66,224,208,0.18)'
            });
            this.#drawContent({ shape: 'roundRect', ...stage, radius: this.#radius(), fill: heroImage ? COLORS.GLASS_WHITE : COLORS.DARK_GLASS });
        }
        const heroImageRect = liveWindowLayout
            ? {
                x: stage.x + stage.w * .19,
                y: stage.y,
                w: stage.w * .62,
                h: stage.h
            }
            : stage;
        if (heroImage) this.#imageUpperBody(heroImageRect, heroImage, animationFrame.motion);
        else {
            this.#drawContent({ shape: 'circle', x: stage.x + stage.w / 2, y: stage.y + stage.h * .49, radius: Math.min(stage.w, stage.h) * .22, fill: COLORS.AQUA, alpha: .45 });
            this.#label('AERO', stage.x + stage.w / 2, stage.y + stage.h * .49, this.#size(UI.TITLE_FONT_WH), COLORS.GLASS_WHITE, { align: 'center', baseline: 'middle', weight: 950 });
        }
        this.#donationAlert(stage);
        if (!liveWindowLayout) {
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
                shadowBlur: 2,
                shadowColor: COLORS.AERO_PINK || '#FF86D7'
            });
        }
        if (activeDonation) {
            this.#timer({ x: stage.x + stage.w * .2, y: stage.y + stage.h * .91, w: stage.w * .6, h: Math.max(9, stage.h * .022) }, activeDonation.timeRemainingSeconds, c.timerMaximums.donation, COLORS.WARNING, '후원 디렉션');
        }
        this.#panel(dialogue, {
            role: 'live-dialogue',
            fill: 'rgba(7,35,59,0.3)',
            contentTint: 'rgba(5,30,51,0.52)',
            stroke: 'rgba(255,255,255,0.5)',
            edgeColor: COLORS.GLASS_HIGHLIGHT,
            edgeStrength: .14,
            shadowRadius: 0,
            lineWidth: 1.2
        });
        if (c.heroResponseText || coreResponsePending) {
            const responseLabel = c.heroResponseLabel || '실시간 답변';
            this.#label(
                coreResponsePending ? '핵심 채팅 대응 대기' : responseLabel,
                dialogue.x + dialogue.w * .055,
                dialogue.y + dialogue.h * .22,
                this.#size(UI.SMALL_FONT_WH),
                responseLabel === '채팅 답변' ? COLORS.AQUA : COLORS.WARNING,
                { baseline: 'middle', weight: 900 }
            );
        }
        const dialogueText = coreResponsePending
            ? '핵심 채팅을 확인한 뒤 강퇴, 삭제 또는 무시 중 대응 방식을 선택해 주세요.'
            : c.heroResponseText || beat.heroText || '방송 시작을 준비하고 있어요.';
        this.#wrapped(dialogueText, dialogue.x + dialogue.w * .055, dialogue.y + dialogue.h * .4, dialogue.w * .89, this.#size(UI.DIALOGUE_FONT_WH), COLORS.GLASS_WHITE, 3);
    }

    /**
     * 모드 전환 뒤 이전 방송의 cue 시간이 새 방송에 이어지지 않도록 시각 타임라인을 초기화합니다.
     * @param {*} elapsedSeconds - 현재 명시적 시각 시간입니다.
     * @private
     */
    #resetHeroMotionTimeline(elapsedSeconds) {
        const visualSeconds = Math.max(0, number(elapsedSeconds));
        this.heroSemanticPose = null;
        this.heroSemanticPoseChangedAt = visualSeconds;
        this.heroBeatId = '';
        this.heroBeatChangedAt = visualSeconds;
        this.heroResponseKey = '';
        this.heroResponseChangedAt = visualSeconds;
        this.heroEventKey = '';
        this.heroEventChangedAt = visualSeconds;
    }

    /** 방송 전환 뒤 이전 후원 알림이 새 방송에 이어지지 않도록 초기화합니다. @private */
    #resetDonationAlertTimeline(elapsedSeconds) {
        this.donationAlertEventKey = '';
        this.donationAlertStartedAt = Math.max(0, number(elapsedSeconds));
        this.#hideDonationAlertDomGif();
    }

    /**
     * Canvas/WebGL 합성 경로 밖에서 GIF의 네이티브 프레임 재생을 유지할 DOM 이미지를 만듭니다.
     * @returns {HTMLImageElement|null} 재생용 이미지입니다.
     * @private
     */
    #ensureDonationAlertDomGif() {
        if (this.destroyed || this.donationAlertDomGif) {
            return this.donationAlertDomGif;
        }
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
            return null;
        }
        const host = document.getElementById?.('overlaylayerhost');
        if (!host?.appendChild) {
            return null;
        }
        try {
            const image = document.createElement('img');
            image.alt = '';
            image.draggable = false;
            image.setAttribute?.('aria-hidden', 'true');
            image.onload = () => {
                this.donationAlertDomGifFailed = false;
            };
            image.onerror = () => {
                this.donationAlertDomGifFailed = true;
                if (image.style) {
                    image.style.display = 'none';
                    image.style.opacity = '0';
                }
            };
            Object.assign(image.style, {
                position: 'absolute',
                display: 'none',
                pointerEvents: 'none',
                userSelect: 'none',
                objectFit: 'contain',
                zIndex: '2',
                transform: 'translateZ(0)',
                willChange: 'transform, opacity'
            });
            host.appendChild(image);
            this.donationAlertDomGif = image;
            return image;
        } catch {
            return null;
        }
    }

    /** 후원 GIF DOM 오버레이를 숨깁니다. @private */
    #hideDonationAlertDomGif() {
        const image = this.donationAlertDomGif;
        if (image?.style) {
            image.style.display = 'none';
            image.style.opacity = '0';
        }
        this.donationAlertDomGifEventKey = '';
    }

    /** 후원 GIF DOM 오버레이와 리스너를 정리합니다. @private */
    #disposeDonationAlertDomGif() {
        const image = this.donationAlertDomGif;
        if (image) {
            image.onload = null;
            image.onerror = null;
            image.removeAttribute?.('src');
            if (image.parentNode?.removeChild) {
                image.parentNode.removeChild(image);
            }
        }
        this.donationAlertDomGif = null;
        this.donationAlertDomGifEventKey = '';
        this.donationAlertDomGifFailed = false;
    }

    /**
     * GIF를 Canvas 대신 네이티브 이미지 요소에서 재생하도록 현재 카드 위치를 동기화합니다.
     * @param {{x:number,y:number,w:number,h:number}} graphic - Canvas 좌표계의 GIF 사각형입니다.
     * @param {number} alpha - 현재 알림 투명도입니다.
     * @param {string} eventKey - 후원 식별 키입니다.
     * @returns {boolean} 네이티브 GIF 오버레이 사용 여부입니다.
     * @private
     */
    #syncDonationAlertDomGif(graphic, alpha, eventKey) {
        const image = this.#ensureDonationAlertDomGif();
        const path = this.donationAlertAsset?.path;
        if (!image?.style || !path) {
            return false;
        }
        if (eventKey !== this.donationAlertDomGifEventKey) {
            this.donationAlertDomGifEventKey = eventKey;
            this.donationAlertDomGifFailed = false;
            image.removeAttribute?.('src');
            image.src = path;
        }
        if (this.donationAlertDomGifFailed) {
            return false;
        }
        const scaleRatio = Math.max(.0001, number(
            typeof getScaleRatio === 'function' ? getScaleRatio() : 1,
            1
        ));
        const canvasOffset = typeof getCanvasOffset === 'function'
            ? getCanvasOffset()
            : { x: 0, y: 0 };
        const host = image.parentNode;
        const insideOverlayHost = host?.id === 'overlaylayerhost';
        const offsetX = insideOverlayHost ? 0 : number(canvasOffset?.x);
        const offsetY = insideOverlayHost ? 0 : number(canvasOffset?.y);
        Object.assign(image.style, {
            display: 'block',
            left: `${offsetX + graphic.x / scaleRatio}px`,
            top: `${offsetY + graphic.y / scaleRatio}px`,
            width: `${graphic.w / scaleRatio}px`,
            height: `${graphic.h / scaleRatio}px`,
            opacity: `${clamp(alpha, 0, 1)}`
        });
        return true;
    }

    /** 캐릭터 오른쪽 위에 후원자·금액·메시지와 GIF를 잠시 표시합니다. @private */
    #donationAlert(stage) {
        const c = this.context;
        const donation = c.snapshot?.activeDonation;
        if (!donation || !stage) {
            this.donationAlertEventKey = '';
            this.#hideDonationAlertDomGif();
            return;
        }

        const eventKey = [
            donation.id,
            donation.donationId,
            donation.author,
            donation.amount,
            donation.text
        ].map((value) => text(value, 180)).join('\u0001');
        const visualSeconds = Math.max(0, number(c.elapsedVisualSeconds));
        if (eventKey !== this.donationAlertEventKey) {
            this.donationAlertEventKey = eventKey;
            this.donationAlertStartedAt = visualSeconds;
        }

        const ageSeconds = Math.max(0, visualSeconds - this.donationAlertStartedAt);
        if (ageSeconds >= DONATION_ALERT_SECONDS) {
            this.#hideDonationAlertDomGif();
            return;
        }
        this.#ensureDonationAlertAsset();

        const fadeIn = clamp(ageSeconds / .22, 0, 1);
        const fadeOut = clamp((DONATION_ALERT_SECONDS - ageSeconds) / .45, 0, 1);
        const alpha = fadeIn * fadeOut;
        const card = {
            x: stage.x + stage.w * .575,
            y: stage.y + stage.h * .065 + (1 - fadeIn) * stage.h * .035,
            w: Math.max(150, stage.w * .36),
            h: Math.max(96, Math.min(stage.h * .38, stage.w * .28))
        };
        card.w = Math.min(card.w, stage.x + stage.w * .95 - card.x);
        card.h = Math.min(card.h, stage.y + stage.h * .58 - card.y);
        if (card.w <= 0 || card.h <= 0 || alpha <= 0) {
            this.#hideDonationAlertDomGif();
            return;
        }

        const graphicSize = Math.max(34, Math.min(card.w * .276, card.h * .468));
        const graphic = {
            x: card.x + (card.w - graphicSize) / 2,
            y: card.y + card.h * .08,
            w: graphicSize,
            h: graphicSize
        };
        const gif = this.donationAlertAsset?.ready
            ? this.donationAlertAsset.image
            : null;
        const gifPlayingNatively = this.#syncDonationAlertDomGif(graphic, alpha, eventKey);
        if (!gifPlayingNatively && gif) {
            this.#drawContent({
                shape: 'image',
                image: gif,
                sx: 0,
                sy: 0,
                sw: Math.max(1, number(gif.naturalWidth || gif.width, 1)),
                sh: Math.max(1, number(gif.naturalHeight || gif.height, 1)),
                ...graphic,
                smoothing: true,
                alpha
            });
        } else if (!gifPlayingNatively) {
            this.#drawContent({
                shape: 'circle',
                x: graphic.x + graphic.w / 2,
                y: graphic.y + graphic.h / 2,
                radius: graphic.w * .42,
                fill: COLORS.AQUA,
                alpha: alpha * .7
            });
            this.#label('♥', graphic.x + graphic.w / 2, graphic.y + graphic.h / 2, graphic.h * .46, COLORS.GLASS_WHITE, {
                align: 'center',
                baseline: 'middle',
                weight: 950,
                alpha
            });
        }

        const author = text(donation.author || donation.viewer_id || '시청자', 18) || '시청자';
        const title = `${author}님이 ${integer(donation.amount)}원 후원!`;
        this.#label(title, card.x + card.w / 2, card.y + card.h * .57, Math.min(this.#size(UI.SUBTITLE_FONT_WH) * .76, card.h * .17), COLORS.AQUA, {
            align: 'center',
            baseline: 'middle',
            weight: 950,
            maxWidth: card.w * .9,
            alpha,
            shadowBlur: 5,
            shadowColor: 'rgba(3,8,17,0.82)'
        });
        this.#wrapped(
            text(donation.text, 96) || '후원해 주셔서 감사합니다!',
            card.x + card.w * .075,
            card.y + card.h * .7,
            card.w * .85,
            Math.min(this.#size(UI.SMALL_FONT_WH), card.h * .12),
            COLORS.GLASS_WHITE,
            2,
            'center',
            {
                alpha,
                shadowBlur: 5,
                shadowColor: 'rgba(3,8,17,0.82)'
            }
        );
    }

    /**
     * 현재 방송 상황을 겹치지 않는 단일 히로인 motion 상태로 바꿉니다.
     * cue 시각은 pose 전환과 분리해 같은 표정의 새 사건도 파형 시작점부터 재생합니다.
     * @param {object} beat - 현재 방송 비트입니다.
     * @param {string} semanticPose - 현재 물리 pose입니다.
     * @param {number} visualSeconds - 현재 명시적 시각 시간입니다.
     * @returns {{state:string,ageSeconds:number}} motion 상태와 경과 시간입니다.
     * @private
     */
    #resolveHeroMotionProfile(beat, semanticPose, visualSeconds) {
        const c = this.context;
        const beatId = String(beat?.id || '');
        if (beatId !== this.heroBeatId) {
            this.heroBeatId = beatId;
            this.heroBeatChangedAt = visualSeconds;
        }

        const responseText = String(c.heroResponseText || '');
        const responseKey = responseText
            ? `${String(c.heroResponseLabel || '')}:${String(c.heroResponseExpression || '')}:${responseText}`
            : '';
        if (responseKey) {
            if (responseKey !== this.heroResponseKey) {
                this.heroResponseKey = responseKey;
                this.heroResponseChangedAt = visualSeconds;
            }
        } else {
            this.heroResponseKey = '';
            this.heroResponseChangedAt = visualSeconds;
        }

        const donation = c.snapshot?.activeDonation || null;
        const core = c.snapshot?.activeCoreChat || null;
        const eventType = donation ? 'donation' : (core ? 'core' : '');
        const event = donation || core;
        const eventIdentity = event
            ? String(event.id || event.donationId || event.coreChatId || event.author || event.text || 'active')
            : '';
        const eventKey = eventType ? `${eventType}:${eventIdentity}` : '';
        if (eventKey) {
            if (eventKey !== this.heroEventKey) {
                this.heroEventKey = eventKey;
                this.heroEventChangedAt = visualSeconds;
            }
        } else {
            this.heroEventKey = '';
            this.heroEventChangedAt = visualSeconds;
        }

        if (c.earlyEndModalOpen) {
            return { state: 'still', ageSeconds: 0 };
        }
        if (responseKey) {
            return {
                state: 'speaking',
                ageSeconds: Math.max(0, visualSeconds - this.heroResponseChangedAt)
            };
        }
        if (c.inputClassificationPending) {
            return { state: 'listening', ageSeconds: 0 };
        }
        if (eventKey) {
            return {
                state: eventType,
                ageSeconds: Math.max(0, visualSeconds - this.heroEventChangedAt)
            };
        }

        const beatAgeSeconds = Math.max(0, visualSeconds - this.heroBeatChangedAt);
        if (beatId && beatAgeSeconds < 0.9) {
            return { state: 'beat', ageSeconds: beatAgeSeconds };
        }
        return {
            state: semanticPose === 'controller' ? 'controller' : 'idle',
            ageSeconds: beatAgeSeconds
        };
    }

    /**
     * 예전 fullscreen 합성에서 현재 stage가 차지하던 원본 영역만 잘라 복원합니다.
     * ocean wallpaper와 외곽 glass 창은 그대로 두고 studio 내부만 2D content로 그립니다.
     * @param {{x:number,y:number,w:number,h:number}} stage - 현재 히로인 무대 영역입니다.
     * @returns {boolean} 배경을 그렸는지 여부입니다.
     * @private
     */
    #drawLiveStageBackground(stage) {
        const c = this.context;
        const record = this.liveStageBackground;
        const image = record?.ready ? record.image : null;
        if (!image || !c || !stage) {
            return false;
        }

        const sourceW = Math.max(1, number(image.naturalWidth || image.width, 1920));
        const sourceH = Math.max(1, number(image.naturalHeight || image.height, 1080));
        const viewportW = Math.max(1, number(c.UIWW, c.WW));
        const viewportH = Math.max(1, number(c.WH));
        const sourceX = clamp((stage.x - number(c.UIOffsetX)) / viewportW, 0, 1) * sourceW;
        const sourceY = clamp(stage.y / viewportH, 0, 1) * sourceH;
        const sourceWidth = Math.max(1, Math.min(
            sourceW - sourceX,
            clamp(stage.w / viewportW, 0, 1) * sourceW
        ));
        const sourceHeight = Math.max(1, Math.min(
            sourceH - sourceY,
            clamp(stage.h / viewportH, 0, 1) * sourceH
        ));
        const inset = Math.max(2, Math.min(this.#radius() * .42, stage.h * .012));
        const target = {
            x: stage.x + inset,
            y: stage.y + inset,
            w: Math.max(1, stage.w - inset * 2),
            h: Math.max(1, stage.h - inset * 2),
            radius: Math.max(1, this.#radius() - inset)
        };
        this.#drawContent({
            shape: 'image',
            image,
            sx: sourceX,
            sy: sourceY,
            sw: sourceWidth,
            sh: sourceHeight,
            ...target,
            smoothing: true,
            clipRect: target
        });
        this.#drawContent({
            shape: 'roundRect',
            ...target,
            fill: 'rgba(5,30,51,0.07)',
            stroke: 'rgba(255,255,255,0.28)',
            lineWidth: 1
        });
        this.liveStageBackgroundRenderedThisFrame = true;
        return true;
    }

    /** 우상 창의 일반·핵심 채팅과 관리 버튼을 그립니다. @private */
    #chatPanel() {
        const c = this.context;
        const rect = c.layout.right;
        const resources = c.snapshot?.resources || {};
        if (!this.#usesLiveWindowLayout()) {
            this.#panel(rect, { fill: COLORS.GLASS_FILL, alpha: .92, tintStrength: .16 });
        }
        this.#label('실시간 채팅', rect.x + c.layout.panelPad, rect.y + c.layout.panelPad * .68, this.#size(UI.SUBTITLE_FONT_WH), COLORS.INK, { baseline: 'middle', weight: 950 });
        this.#label(`남은 채팅 횟수 ${integer(resources.playerMessagesRemaining)}회`, rect.x + rect.w - c.layout.panelPad, rect.y + c.layout.panelPad * .68, this.#size(UI.SMALL_FONT_WH), COLORS.DEEP_BLUE, { align: 'right', baseline: 'middle', weight: 850 });
        if (this.#usesLiveWindowLayout()) {
            this.#macWindowControls(c.layout.chatWindowControls);
        }
        this.#chats();
        c.coreButtons.forEach((button) => {
            const id = button.aeroData?.id;
            const label = id === 'kick' ? `강퇴 ${integer(resources.kicksRemaining)}` : button.aeroData?.label;
            this.#button(button, label || '처리', COLORS.DARK_GLASS, CORE_COLORS[id] || COLORS.AQUA, COLORS.GLASS_WHITE, button.aeroDisabled);
        });
        if (c.tutorial?.active) {
            this.#tutorialChatPreview(c.tutorial.target);
        }
        if (c.inputClassificationPending) {
            const composer = c.layout.composer;
            this.#label('AI 판정 중 · 활성 이벤트 타이머 일시정지', composer.x, composer.y - c.layout.gap * .42, this.#size(UI.SMALL_FONT_WH), COLORS.NEGATIVE, { baseline: 'bottom', weight: 800, maxWidth: composer.w });
        }
    }

    /** 실제 방송 시작 전에도 안내 대상의 위치를 알 수 있도록 비상호작용 미리보기를 그립니다. @private */
    #tutorialChatPreview(target) {
        const c = this.context;
        const scale = Math.max(1, number(c.layout?.pixelScale, 1));
        const showComposer = target === 'composer' || target === 'chat-send';
        const showChat = target === 'chat' || target === 'chat-send';
        if (showComposer) {
            const rect = c.layout.composer;
            const nicknameW = Math.max(64 * scale, rect.w * .2);
            const sendW = Math.max(58 * scale, rect.w * .16);
            this.#drawContent({
                shape: 'roundRect', ...rect, radius: Math.min(this.#radius() * .62, rect.h * .34),
                fill: 'rgba(7,35,59,0.86)', stroke: 'rgba(245,254,255,0.38)', lineWidth: 1
            });
            this.#drawContent({
                shape: 'roundRect', x: rect.x, y: rect.y, w: nicknameW, h: rect.h, radius: Math.min(this.#radius() * .62, rect.h * .34),
                fill: 'rgba(66,224,208,0.22)'
            });
            this.#drawContent({
                shape: 'roundRect', x: rect.x + rect.w - sendW, y: rect.y, w: sendW, h: rect.h, radius: Math.min(this.#radius() * .62, rect.h * .34),
                fill: 'rgba(66,224,208,0.82)'
            });
            this.#label(c.playerName || '플레이어', rect.x + nicknameW * .5, rect.y + rect.h * .5, this.#size(UI.SMALL_FONT_WH), COLORS.AQUA, { align: 'center', baseline: 'middle', weight: 900, maxWidth: nicknameW * .82 });
            this.#label('방송에 남길 채팅을 입력하세요', rect.x + nicknameW + rect.w * .035, rect.y + rect.h * .5, this.#size(UI.SMALL_FONT_WH), 'rgba(245,254,255,0.64)', { baseline: 'middle', weight: 700, maxWidth: rect.w - nicknameW - sendW - rect.w * .08 });
            this.#label('전송', rect.x + rect.w - sendW * .5, rect.y + rect.h * .5, this.#size(UI.SMALL_FONT_WH), COLORS.INK, { align: 'center', baseline: 'middle', weight: 950, maxWidth: sendW * .8 });
            if (!showChat) {
                return;
            }
        }

        const chatArea = c.layout.chatArea;
        if (showChat) {
            const row = {
                x: chatArea.x + chatArea.w * .045,
                y: chatArea.y + chatArea.h * .46,
                w: chatArea.w * .91,
                h: Math.max(34 * scale, chatArea.h * .11)
            };
            this.#drawContent({
                shape: 'roundRect', ...row, radius: Math.max(5, row.h * .2),
                fill: 'rgba(20,102,151,0.82)',
                stroke: 'rgba(143,241,255,0.58)',
                lineWidth: 1
            });
            this.#drawContent({ shape: 'roundRect', x: row.x + 5, y: row.y + row.h * .25, w: 5, h: row.h * .5, radius: 999, fill: COLORS.AQUA });
            this.#label(c.playerName || '플레이어', row.x + row.w * .08, row.y + row.h * .5, this.#size(UI.SMALL_FONT_WH), COLORS.GLASS_WHITE, { baseline: 'middle', weight: 900, maxWidth: row.w * .28 });
            this.#label('내가 전송한 채팅은 이곳에 표시됩니다.', row.x + row.w * .38, row.y + row.h * .5, this.#size(UI.SMALL_FONT_WH), COLORS.GLASS_WHITE, { baseline: 'middle', weight: 850, maxWidth: row.w * .55 });
            return;
        }

        if (target === 'core') {
            const row = {
                x: chatArea.x + chatArea.w * .045,
                y: chatArea.y + chatArea.h * .4,
                w: chatArea.w * .91,
                h: Math.max(34 * scale, chatArea.h * .11)
            };
            this.#drawContent({ shape: 'roundRect', ...row, radius: Math.max(5, row.h * .2), fill: 'rgba(196,141,20,0.82)', stroke: 'rgba(255,225,128,0.88)', lineWidth: 1.2 });
            this.#label('CORE · 관리할 채팅', row.x + row.w * .055, row.y + row.h * .5, this.#size(UI.SMALL_FONT_WH), COLORS.INK, { baseline: 'middle', weight: 950, maxWidth: row.w * .86 });
            c.layout.coreActionRects.forEach((rect, index) => {
                const labels = ['강퇴', '삭제', '무시'];
                this.#drawContent({ shape: 'roundRect', ...rect, radius: Math.max(5, rect.h * .22), fill: 'rgba(7,35,59,0.88)', stroke: 'rgba(245,254,255,0.26)', lineWidth: 1 });
                this.#label(labels[index] || '관리', rect.x + rect.w * .5, rect.y + rect.h * .5, this.#size(UI.SMALL_FONT_WH), COLORS.GLASS_WHITE, { align: 'center', baseline: 'middle', weight: 900, maxWidth: rect.w * .85 });
            });
        }
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
        this.#drawContent({ shape: 'roundRect', ...rect, radius: this.#radius() * .7, fill: 'rgba(245,254,255,0.27)', stroke: COLORS.GLASS_BORDER, lineWidth: 1 });
        if (!rows.length) {
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
                shadowBlur: coreSelected ? 4 : 0,
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
                shadowBlur: 2,
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
            ['시작', displayedViewerCount(start.viewers), COLORS.INK],
            ['종료', displayedViewerCount(m.viewers), COLORS.AQUA],
            ['최고 동시', displayedViewerCount(result.peakViewers ?? m.peakViewers ?? m.viewers), COLORS.DEEP_BLUE]
        ].forEach((item, index) => this.#resultStat(item[0], item[1], {
            x: leftX + index * (viewerCardW + viewerGap), y: viewerCardY, w: viewerCardW, h: viewerCardH
        }, item[2], true));

        const positiveRatio = clamp(result.positiveViewerRatio ?? (number(m.viewers) > 0 ? number(m.positiveViewers) / number(m.viewers) * 100 : 0), 0, 100);
        const negativeRatio = clamp(100 - positiveRatio, 0, 100);
        const splitY = left.y + left.h * .265;
        this.#resultStat('긍정 시청자', `${displayedViewerCount(m.positiveViewers)}명 · ${positiveRatio.toFixed(1)}%`, { x: leftX, y: splitY, w: leftW, h: left.h * .072 }, COLORS.POSITIVE);
        this.#resultStat('부정 시청자', `${displayedViewerCount(m.negativeViewers)}명 · ${negativeRatio.toFixed(1)}%`, { x: leftX, y: splitY + left.h * .079, w: leftW, h: left.h * .072 }, COLORS.NEGATIVE);

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
        this.#label('아쿠아의 한마디', heroRect.x + heroRect.w * .035, heroRect.y + heroRect.h * .25, this.#size(UI.SMALL_FONT_WH), COLORS.AQUA, { baseline: 'middle', weight: 900 });
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

    /** 첫 방송 전에 표시하는 포커스 비네팅과 안내 카드를 그립니다. @private */
    #tutorial() {
        const tutorial = this.context?.tutorial;
        if (!tutorial?.active || !tutorial.vignette) {
            return;
        }
        this.#drawTutorialVignette(tutorial.vignette);
        if (tutorial.text?.opacity > .001) {
            this.#drawTutorialText(tutorial.text, tutorial.canAdvance === true);
        }
    }

    /** 포커스 중심만 투명하게 남기는 재사용 가능한 비네팅 캔버스를 준비합니다. @private */
    #ensureTutorialVignetteCanvas() {
        const c = this.context;
        const width = Math.max(1, Math.round(number(c?.WW, 1)));
        const height = Math.max(1, Math.round(number(c?.WH, 1)));
        if (this.tutorialVignetteCanvas
            && this.tutorialVignetteContext
            && this.tutorialVignetteCanvas.width === width
            && this.tutorialVignetteCanvas.height === height) {
            return this.tutorialVignetteCanvas;
        }
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
            return null;
        }
        try {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext?.('2d');
            if (!context) {
                return null;
            }
            canvas.width = width;
            canvas.height = height;
            this.tutorialVignetteCanvas = canvas;
            this.tutorialVignetteContext = context;
            this.tutorialVignetteSignature = '';
            return canvas;
        } catch {
            return null;
        }
    }

    /** 포커스 반경 바깥을 부드럽게 어둡게 하는 마스크를 그립니다. @private */
    #drawTutorialVignette(vignette) {
        const c = this.context;
        const alpha = clamp(number(vignette.alpha), 0, .92);
        if (alpha <= .001) {
            return;
        }
        const canvas = this.#ensureTutorialVignetteCanvas();
        const context = this.tutorialVignetteContext;
        if (!canvas || !context || typeof context.beginPath !== 'function') {
            this.#drawContent({
                shape: 'rect', x: 0, y: 0, w: c.WW, h: c.WH,
                fill: 'rgba(2,7,15,0.8)', alpha
            });
            return;
        }
        const centerX = clamp(number(vignette.x), 0, c.WW);
        const centerY = clamp(number(vignette.y), 0, c.WH);
        const radius = Math.max(1, number(vignette.radius, 1));
        const pixelScale = Math.max(1, number(c.layout?.pixelScale, 1));
        const sourceRect = vignette.rect || {
            x: centerX - radius * .74,
            y: centerY - radius * .52,
            w: radius * 1.48,
            h: radius * 1.04
        };
        const focusPadding = clamp(radius * .16, 14 * pixelScale, 56 * pixelScale);
        const focusRect = {
            x: number(sourceRect.x) - focusPadding,
            y: number(sourceRect.y) - focusPadding,
            w: Math.max(1, number(sourceRect.w, 1) + focusPadding * 2),
            h: Math.max(1, number(sourceRect.h, 1) + focusPadding * 2)
        };
        const cornerRadius = Math.min(
            Math.max(8 * pixelScale, Math.min(focusRect.w, focusRect.h) * .14),
            Math.min(focusRect.w, focusRect.h) * .5
        );
        const feather = clamp(
            Math.min(focusRect.w, focusRect.h) * .16,
            10 * pixelScale,
            34 * pixelScale
        );
        const signature = [
            Math.round(focusRect.x * 4),
            Math.round(focusRect.y * 4),
            Math.round(focusRect.w * 4),
            Math.round(focusRect.h * 4),
            Math.round(alpha * 1000)
        ].join(':');
        if (signature !== this.tutorialVignetteSignature) {
            this.tutorialVignetteSignature = signature;
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = `rgba(2,7,15,${alpha})`;
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.save();
            context.globalCompositeOperation = 'destination-out';
            context.filter = `blur(${feather}px)`;
            context.fillStyle = 'rgba(0,0,0,1)';
            context.beginPath();
            context.moveTo(focusRect.x + cornerRadius, focusRect.y);
            context.lineTo(focusRect.x + focusRect.w - cornerRadius, focusRect.y);
            context.quadraticCurveTo(
                focusRect.x + focusRect.w,
                focusRect.y,
                focusRect.x + focusRect.w,
                focusRect.y + cornerRadius
            );
            context.lineTo(focusRect.x + focusRect.w, focusRect.y + focusRect.h - cornerRadius);
            context.quadraticCurveTo(
                focusRect.x + focusRect.w,
                focusRect.y + focusRect.h,
                focusRect.x + focusRect.w - cornerRadius,
                focusRect.y + focusRect.h
            );
            context.lineTo(focusRect.x + cornerRadius, focusRect.y + focusRect.h);
            context.quadraticCurveTo(
                focusRect.x,
                focusRect.y + focusRect.h,
                focusRect.x,
                focusRect.y + focusRect.h - cornerRadius
            );
            context.lineTo(focusRect.x, focusRect.y + cornerRadius);
            context.quadraticCurveTo(
                focusRect.x,
                focusRect.y,
                focusRect.x + cornerRadius,
                focusRect.y
            );
            context.closePath();
            context.fill();
            context.restore();
        }
        this.#drawContent({
            shape: 'image', image: canvas,
            x: 0, y: 0, w: c.WW, h: c.WH,
            smoothing: true
        });
    }

    /** 포커스 대상 가까이에 두꺼운 검정 유리 설명창을 배치합니다. @private */
    #drawTutorialText(tutorialText, canAdvance) {
        const c = this.context;
        const target = tutorialText.targetRect || c.layout.right;
        const pixelScale = Math.max(1, number(c.layout?.pixelScale, 1));
        const cardW = clamp(c.UIWW * .275, 320 * pixelScale, 560 * pixelScale);
        const cardH = clamp(c.WH * .175, 132 * pixelScale, 214 * pixelScale);
        const gap = Math.max(12 * pixelScale, c.layout.panelPad * .8);
        const minimumX = c.UIOffsetX + gap;
        const maximumX = c.UIOffsetX + c.UIWW - cardW - gap;
        const preferredX = number(target.x) + number(target.w) * .5 - cardW * .5;
        const x = clamp(preferredX, minimumX, Math.max(minimumX, maximumX));
        const aboveY = number(target.y) - cardH - gap;
        const belowY = number(target.y) + number(target.h) + gap;
        const y = aboveY >= gap
            ? aboveY
            : belowY + cardH <= c.WH - gap
                ? belowY
                : clamp(number(target.y) + number(target.h) * .1, gap, c.WH - cardH - gap);
        const scale = clamp(number(tutorialText.scale, 1), .9, 1);
        const opacity = clamp(number(tutorialText.opacity), 0, 1);
        const rect = {
            x: x + cardW * (1 - scale) * .5,
            y: y + cardH * (1 - scale) * .5,
            w: cardW * scale,
            h: cardH * scale
        };
        const tutorialSession = this.#ensureTutorialGlassSession();
        const previousContentLayer = this.contentLayer;
        if (tutorialSession?.uiLayerId) {
            this.contentLayer = tutorialSession.uiLayerId;
        }
        try {
            this.#panel(rect, {
                role: 'tutorial-text',
                session: tutorialSession,
                forceGlass: tutorialSession?.isGlassEnabled?.() === true,
                fill: 'rgba(3,9,18,0.64)',
                flatFill: 'rgba(3,9,18,0.88)',
                contentTint: 'rgba(0,0,0,0.18)',
                stroke: 'rgba(245,254,255,0.34)',
                edgeColor: 'rgba(245,254,255,0.38)',
                tintColor: 'rgba(0,0,0,1)',
                tintStrength: .08,
                edgeStrength: .18,
                blur: GLASS_STYLE.BLUR * 1.8,
                forceBlurRefresh: true,
                shadowColor: 'rgba(0,0,0,0.62)',
                shadowRadius: 14 * pixelScale,
                lineWidth: Math.max(1.5, 1.5 * pixelScale),
                alpha: opacity
            });
            const contentX = rect.x + rect.w * .075;
            const contentW = rect.w * .85;
            this.#label(tutorialText.title, contentX, rect.y + rect.h * .18, this.#size(UI.SUBTITLE_FONT_WH) * scale, COLORS.GLASS_WHITE, {
                baseline: 'middle', weight: 950, maxWidth: contentW, alpha: opacity
            });
            this.#wrapped(tutorialText.text, contentX, rect.y + rect.h * .36, contentW, this.#size(UI.BODY_FONT_WH) * scale, COLORS.GLASS_WHITE, 4, 'left', {
                weight: 800,
                alpha: opacity,
                shadowBlur: 2,
                shadowColor: 'rgba(0,0,0,0.7)'
            });
            if (canAdvance) {
                this.#label('클릭 · Space >>', rect.x + rect.w * .925, rect.y + rect.h * .87, this.#size(UI.SMALL_FONT_WH) * scale, 'rgba(245,254,255,0.72)', {
                    align: 'right', baseline: 'middle', weight: 800, maxWidth: contentW, alpha: opacity
                });
            }
        } finally {
            this.contentLayer = previousContentLayer;
        }
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
            shadowColor: COLORS.GLASS_SHADOW,
            shadowRadius: 8,
            contentOnly: true,
            lineWidth: 2.5
        });
        this.#label('방송을 조기 종료할까요?', rect.x + rect.w / 2, rect.y + rect.h * .2, this.#size(UI.SUBTITLE_FONT_WH) * 1.15, COLORS.INK, { align: 'center', weight: 950 });
        this.#wrapped('현재 기록으로 결과를 확정하고 진행 중인 이벤트를 종료합니다.', rect.x + rect.w * .12, rect.y + rect.h * .36, rect.w * .76, this.#size(UI.BODY_FONT_WH), COLORS.INK, 2, 'center');
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
        const height = Math.max(42, c.WH * .062);
        const liveY = c.layout?.heroDialogue
            ? c.layout.heroDialogue.y - height - c.layout.gap * .6
            : c.WH * .84;
        const rect = {
            x: c.UIOffsetX + (c.UIWW - width) / 2,
            y: c.mode === 'live' ? liveY : c.WH * .89,
            w: width,
            h: height
        };
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
                fill: color, shadowBlur: 3, shadowColor: color
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
                fill: color, shadowBlur: 3, shadowColor: color
            });
            this.#drawContent({
                shape: 'roundRect', x: rect.x + 1, y: rect.y + 1, w: Math.max(1, fillW - 2), h: Math.max(1, rect.h * .3), radius: 999,
                fill: COLORS.GLASS_WHITE, alpha: .4
            });
        }
        this.#label(`${label} · ${Math.ceil(left)}초${this.context.inputClassificationPending ? ' · PAUSE' : ''}`, rect.x + rect.w, rect.y - Math.max(5, rect.h * .55), this.#size(UI.SMALL_FONT_WH), labelColor, { align: 'right', baseline: 'bottom', weight: 900, maxWidth: rect.w });
    }

    /** 우상단에 광택과 그림자가 있는 macOS형 빨강·노랑·초록 창 컨트롤을 그립니다. @private */
    #macWindowControls(layout, closeButton = null) {
        if (!layout || !Array.isArray(layout.buttons)) return;
        const styles = {
            red: { top: '#FFD0CC', middle: '#FF857E', lower: '#FF5750', bottom: '#C92824', shadow: 'rgba(202,39,35,0.3)' },
            yellow: { top: '#FFF3BF', middle: '#FFE17A', lower: '#FFB927', bottom: '#D68E06', shadow: 'rgba(191,130,7,0.27)' },
            green: { top: '#C7F8D0', middle: '#79E992', lower: '#27C840', bottom: '#138F2A', shadow: 'rgba(20,145,45,0.27)' }
        };
        const closeHover = closeButton?.visible && !closeButton.aeroDisabled
            ? clamp(closeButton.hoverValue, 0, 1)
            : 0;
        for (const control of layout.buttons) {
            const style = styles[control.color] || styles.green;
            const hover = control.id === 'close' ? closeHover : 0;
            const radius = Math.max(2, number(control.radius, 5) * (1 + hover * .08));
            this.#drawContent({
                shape: 'circle',
                x: control.x,
                y: control.y,
                radius,
                fill: {
                    type: 'radial',
                    x0: control.x - radius * .28,
                    y0: control.y - radius * .34,
                    r0: 0,
                    x1: control.x - radius * .28,
                    y1: control.y - radius * .34,
                    r1: radius * 1.46,
                    fallback: style.middle,
                    stops: [
                        { offset: 0, color: style.top },
                        { offset: .34, color: style.middle },
                        { offset: .72, color: style.lower },
                        { offset: 1, color: style.bottom }
                    ]
                },
                stroke: hover > 0 ? COLORS.GLASS_WHITE : 'rgba(74,55,48,0.34)',
                lineWidth: Math.max(1, radius * .08),
                shadowBlur: radius * (.24 + hover * .22),
                shadowColor: style.shadow
            });
        }
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
            lineWidth: 1.25,
            alpha: disabled ? .45 : .96,
            shadowBlur: disabled ? 0 : hover * 6,
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
                        { offset: 0, color: 'rgba(255,255,255,0.52)' },
                        { offset: 1, color: 'rgba(255,255,255,0)' }
                    ]
                },
                alpha: .38 + hover * .14
            });
        }
        this.#label(label, rect.x + rect.w / 2, rect.y + rect.h / 2, Math.min(this.#size(UI.BODY_FONT_WH), rect.h * .34), textColor, { align: 'center', baseline: 'middle', weight: 900, maxWidth: rect.w * .9, alpha: disabled ? .55 : 1 });
    }

    /** wallpaper 준비 상태와 무관하게 방송 창 좌표계를 쓰는지 반환합니다. @private */
    #usesLiveWindowLayout() {
        return this.context?.mode === 'live';
    }

    /** 유리 패널을 그립니다. @private */
    #panel(rect, style = {}) {
        const radius = this.#radius();
        const alpha = style.alpha ?? .96;
        const fill = style.fill || COLORS.GLASS_FILL;
        const flatFill = style.flatFill || fill;
        const stroke = style.stroke || COLORS.GLASS_BORDER;
        const lineWidth = style.lineWidth || 1;
        const session = style.session || this.glassSession;
        if (!style.contentOnly
            && (this.wallpaperRenderedThisFrame || style.forceGlass === true)
            && session?.isGlassEnabled?.()) {
            session.renderGlassPanel({
                debugRole: style.role || '',
                x: rect.x,
                y: rect.y,
                w: rect.w,
                h: rect.h,
                radius,
                blur: style.blur ?? GLASS_STYLE.BLUR,
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
                forceBlurRefresh: style.forceBlurRefresh === true,
                alpha
            });
        } else {
            this.#drawContent({
                shape: 'roundRect', ...rect, radius, fill: flatFill, stroke, lineWidth, alpha,
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
            alpha: alpha * .44
        });
        const defaultTopSheenHeight = Math.max(
            6 * this.#uiScale(),
            Math.min(rect.h * .11, 28 * this.#uiScale())
        );
        const topSheenHeight = Math.min(
            Math.max(1, rect.h - inset * 2),
            Number.isFinite(style.topSheenHeight) ? style.topSheenHeight : defaultTopSheenHeight
        );
        this.#drawContent({
            shape: 'roundRect',
            x: rect.x + inset + 1,
            y: rect.y + inset + 1,
            w: Math.max(1, rect.w - (inset + 1) * 2),
            h: topSheenHeight,
            radius: Math.max(2, radius - inset - 1),
            fill: {
                type: 'linear', x1: 0, y1: rect.y + inset, x2: 0, y2: rect.y + inset + topSheenHeight,
                stops: [
                    { offset: 0, color: COLORS.GLASS_HIGHLIGHT || 'rgba(255,255,255,0.7)' },
                    { offset: .18, color: 'rgba(255,255,255,0.34)' },
                    { offset: .56, color: 'rgba(255,255,255,0.1)' },
                    { offset: 1, color: 'rgba(255,255,255,0)' }
                ]
            },
            alpha: alpha * (style.topSheenAlpha ?? .56)
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
    #wrapped(value, x, y, width, size, color, maxLines = 3, align = 'left', options = {}) {
        const weight = options.weight || 750;
        const font = createFontString({ weight, sizePx: size, family: FONT_FAMILY });
        const lines = wrapTextByCharacters(this.#displayText(value, 600), { maxWidth: width, maxLines, measureWidth: (candidate) => measureText(candidate, font) });
        lines.forEach((line, index) => this.#label(line, align === 'center' ? x + width / 2 : x, y + index * size * 1.28, size, color, {
            align,
            weight,
            maxWidth: width,
            alpha: options.alpha,
            shadowBlur: options.shadowBlur,
            shadowColor: options.shadowColor
        }));
    }

    /** 세로 원본의 상반신 crop에 하단 앵커형 호흡·탄성 transform을 적용합니다. @private */
    #imageUpperBody(rect, image, motion = {}) {
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
        const scaleX = clamp(number(motion.scaleX, 1), .92, 1.08);
        const scaleY = clamp(number(motion.scaleY, 1), .92, 1.08);
        const drawW = rect.w * scaleX;
        const drawH = rect.h * scaleY;
        const offsetX = rect.w * clamp(number(motion.offsetXRatio), -.05, .05);
        const offsetY = rect.h * clamp(number(motion.offsetYRatio), -.05, .05);
        this.#drawContent({
            shape: 'image',
            image,
            sx: cropX,
            sy: upperTop,
            sw: cropW,
            sh: cropH,
            x: rect.x + (rect.w - drawW) / 2 + offsetX,
            y: rect.y + rect.h - drawH + offsetY,
            w: drawW,
            h: drawH,
            rotation: clamp(number(motion.rotation), -2.5, 2.5),
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

    /** 1080p 기준의 고정 픽셀 값을 고해상도에서도 같은 비율로 유지합니다. @private */
    #uiScale() {
        const c = this.context || {};
        return Math.max(1, Math.min(
            Math.max(1, number(c.UIWW, c.WW)) / 1920,
            Math.max(1, number(c.WH)) / 1080
        ));
    }

    /** 현재 화면 비율의 공통 패널 반경을 반환합니다. @private */
    #radius() {
        return Math.max(8, this.context.WH * UI.PANEL_RADIUS_WH / 100);
    }
}
