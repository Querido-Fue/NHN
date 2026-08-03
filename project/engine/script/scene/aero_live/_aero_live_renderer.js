import { getData } from 'data/data_handler.js';
import { measureText, render, renderGL } from 'display/display_system.js';
import { createFontString, truncateTextToWidth, wrapTextByCharacters } from 'util/font_util.js';

const AERO_CONSTANTS = getData('AERO_LIVE_SCENE_CONSTANTS');
const UI = AERO_CONSTANTS.UI;
const COLORS = AERO_CONSTANTS.COLORS;
const HERO_EXPRESSION_PATHS = AERO_CONSTANTS.ASSET.HERO_EXPRESSION_PATHS || {};
const HERO_FALLBACK_EXPRESSION = AERO_CONSTANTS.ASSET.HERO_FALLBACK_EXPRESSION || 'default';
const FONT_FAMILY = 'Pretendard Variable, arial';
const TOPIC_ACCENTS = Object.freeze(['#42E0D0', '#62D65B', '#FFD65A', '#FF8AA1', '#7B9CFF']);
const CORE_COLORS = Object.freeze({ kick: COLORS.NEGATIVE, ignore: COLORS.NEUTRAL });
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
        this.#backdrop();
        if (context.mode === 'topicSelect') this.#topics();
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
        this.context = null;
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

    /** 하늘, 수면색 띠와 장식 기포를 그립니다. @private */
    #backdrop() {
        const c = this.context;
        renderGL('background', { shape: 'rect', x: c.WW / 2, y: c.WH / 2, w: c.WW, h: c.WH, fill: COLORS.SKY_TOP });
        render('ui', { shape: 'rect', x: 0, y: 0, w: c.WW, h: c.WH, fill: COLORS.SKY_BOTTOM });
        render('ui', { shape: 'rect', x: c.UIOffsetX, y: 0, w: c.UIWW, h: c.WH * 0.43, fill: COLORS.SKY_TOP, alpha: 0.78 });
        render('ui', { shape: 'rect', x: c.UIOffsetX, y: c.WH * 0.43, w: c.UIWW, h: c.WH * 0.57, fill: COLORS.AQUA, alpha: 0.09 });
        [[.07, .18, 25], [.17, .74, 42], [.68, .13, 34], [.84, .77, 50], [.94, .3, 22]].forEach((seed, index) => {
            render('ui', {
                shape: 'circle',
                x: c.UIOffsetX + c.UIWW * seed[0],
                y: c.WH * seed[1] + Math.sin(c.elapsedVisualSeconds * .6 + index) * 6,
                radius: seed[2],
                fill: COLORS.GLASS_WHITE,
                stroke: COLORS.GLASS_BORDER,
                lineWidth: 2,
                alpha: .14
            });
        });
    }

    /** 다섯 방송 주제 카드와 조작 안내를 그립니다. @private */
    #topics() {
        const c = this.context;
        const center = c.UIOffsetX + c.UIWW / 2;
        this.#label('AERO LIVE', center, c.WH * .095, this.#size(UI.TITLE_FONT_WH), COLORS.INK, { align: 'center', weight: 950 });

        c.topicButtons.forEach((button, index) => {
            const topic = c.topicSummaries[index] || {};
            const rect = this.#buttonRect(button);
            const accent = TOPIC_ACCENTS[index % TOPIC_ACCENTS.length];
            this.#panel(rect, { fill: COLORS.GLASS_FILL_STRONG, stroke: accent, lineWidth: 2 + button.hoverValue * 2 });
            render('ui', { shape: 'roundRect', x: rect.x + rect.w * .07, y: rect.y + rect.h * .07, w: rect.w * .86, h: Math.max(7, rect.h * .055), radius: 999, fill: accent });
            render('ui', { shape: 'circle', x: rect.x + rect.w * .16, y: rect.y + rect.h * .28, radius: Math.min(rect.w, rect.h) * .095, fill: accent });
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
        this.#panel(rect, { fill: COLORS.GLASS_FILL_STRONG });
        const pill = { x: rect.x + pad * .6, y: rect.y + rect.h * .24, w: Math.max(64, rect.h * 1.25), h: rect.h * .52 };
        render('ui', { shape: 'roundRect', ...pill, radius: 999, fill: COLORS.LIVE });
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

    /** 후원 카드, 방송 지표와 다섯 지시를 그립니다. @private */
    #leftPanel() {
        const c = this.context;
        const rect = c.layout.left;
        const m = c.snapshot?.metrics || {};
        this.#panel(rect, { fill: COLORS.GLASS_FILL, alpha: .92 });
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
        const active = c.snapshot?.activeCoreChat || c.snapshot?.activeDonation;
        const heroImage = this.#heroImageForExpression(beat.expression);
        this.#panel(c.layout.center, { fill: COLORS.GLASS_FILL, alpha: .89 });
        render('ui', { shape: 'roundRect', ...stage, radius: this.#radius(), fill: heroImage ? COLORS.GLASS_WHITE : COLORS.DARK_GLASS });
        if (heroImage) this.#imageUpperBody(stage, heroImage);
        else {
            render('ui', { shape: 'circle', x: stage.x + stage.w / 2, y: stage.y + stage.h * .49, radius: Math.min(stage.w, stage.h) * .22, fill: COLORS.AQUA, alpha: .45 });
            this.#label('AERO', stage.x + stage.w / 2, stage.y + stage.h * .49, this.#size(UI.TITLE_FONT_WH), COLORS.GLASS_WHITE, { align: 'center', baseline: 'middle', weight: 950 });
        }
        const tag = { x: stage.x + stage.w * .03, y: stage.y + stage.h * .035, w: stage.w * .31, h: Math.max(28, stage.h * .075) };
        render('ui', { shape: 'roundRect', ...tag, radius: 999, fill: COLORS.DARK_GLASS, alpha: .84 });
        const expressionLabel = EXPRESSION_LABELS[beat.expression] || text(beat.expression || '기본', 14);
        const moodLabel = MOOD_LABELS[beat.mood] || text(beat.mood || '평온', 14);
        this.#label(`${expressionLabel} · ${moodLabel}`, tag.x + tag.w / 2, tag.y + tag.h / 2, this.#size(UI.SMALL_FONT_WH), COLORS.GLASS_WHITE, { align: 'center', baseline: 'middle', weight: 850, maxWidth: tag.w * .9 });
        if (active) {
            const core = !!c.snapshot?.activeCoreChat;
            this.#timer({ x: stage.x + stage.w * .2, y: stage.y + stage.h * .91, w: stage.w * .6, h: Math.max(9, stage.h * .022) }, active.timeRemainingSeconds, core ? c.timerMaximums.core : c.timerMaximums.donation, core ? COLORS.NEGATIVE : COLORS.WARNING, core ? '핵심 채팅 결정' : '후원 디렉션');
        }
        this.#panel(dialogue, { fill: COLORS.DARK_GLASS, stroke: COLORS.AQUA, lineWidth: 1.5 });
        this.#label(`BEAT ${number(beat.index) + 1} / ${Math.max(1, number(beat.total, 1))}`, dialogue.x + dialogue.w * .055, dialogue.y + dialogue.h * .22, this.#size(UI.SMALL_FONT_WH), COLORS.AQUA, { baseline: 'middle', weight: 900 });
        if (c.heroResponseText) {
            this.#label('후원 대응', dialogue.x + dialogue.w * .23, dialogue.y + dialogue.h * .22, this.#size(UI.SMALL_FONT_WH), COLORS.WARNING, { baseline: 'middle', weight: 900 });
        }
        this.#wrapped(c.heroResponseText || beat.heroText || '방송 시작을 준비하고 있어요.', dialogue.x + dialogue.w * .055, dialogue.y + dialogue.h * .4, dialogue.w * .89, this.#size(UI.DIALOGUE_FONT_WH), COLORS.GLASS_WHITE, 3);
    }

    /** 우측 일반·핵심 채팅과 관리 버튼을 그립니다. @private */
    #chatPanel() {
        const c = this.context;
        const rect = c.layout.right;
        const resources = c.snapshot?.resources || {};
        this.#panel(rect, { fill: COLORS.GLASS_FILL, alpha: .92 });
        this.#label('실시간 채팅', rect.x + c.layout.panelPad, rect.y + c.layout.panelPad * .68, this.#size(UI.SUBTITLE_FONT_WH), COLORS.INK, { baseline: 'middle', weight: 950 });
        this.#label(`자유 채팅 ${integer(resources.playerMessagesRemaining)}회`, rect.x + rect.w - c.layout.panelPad, rect.y + c.layout.panelPad * .68, this.#size(UI.SMALL_FONT_WH), COLORS.DEEP_BLUE, { align: 'right', baseline: 'middle', weight: 850 });
        this.#chats();
        this.#core();
        c.coreButtons.forEach((button) => {
            const id = button.aeroData?.id;
            const label = id === 'kick' ? `강퇴 ${integer(resources.kicksRemaining)}` : button.aeroData?.label;
            this.#button(button, label || '처리', COLORS.DARK_GLASS, CORE_COLORS[id] || COLORS.AQUA, COLORS.GLASS_WHITE, button.aeroDisabled);
        });
        const composer = c.layout.composer;
        const state = c.inputClassificationPending ? 'AI 판정 중 · 활성 이벤트 타이머 일시정지' : '가면 계정으로 방송 여론에 개입할 수 있습니다.';
        this.#label(state, composer.x, composer.y - c.layout.gap * .42, this.#size(UI.SMALL_FONT_WH), c.inputClassificationPending ? COLORS.NEGATIVE : COLORS.INK_MUTED, { baseline: 'bottom', weight: 800, maxWidth: composer.w });
    }

    /** 최근 일반 채팅을 고정 행으로 그립니다. @private */
    #chats() {
        const c = this.context;
        const rect = c.layout.chatArea;
        const count = Math.max(1, Math.floor(number(UI.CHAT_VISIBLE_COUNT, 9)));
        const chats = Array.isArray(c.snapshot?.chats) ? c.snapshot.chats.slice(-count) : [];
        render('ui', { shape: 'roundRect', ...rect, radius: this.#radius() * .7, fill: 'rgba(245,254,255,0.48)', stroke: COLORS.GLASS_BORDER, lineWidth: 1 });
        if (!chats.length) {
            this.#label('시청자 채팅을 기다리는 중입니다.', rect.x + rect.w / 2, rect.y + rect.h / 2, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { align: 'center', baseline: 'middle', weight: 700 });
            return;
        }
        const rowH = Math.max(23, Math.min(c.WH * UI.CHAT_LINE_HEIGHT_WH / 100, rect.h / count));
        const startY = rect.y + rect.h - chats.length * rowH;
        chats.forEach((chat, index) => {
            const row = { x: rect.x + 3, y: startY + index * rowH, w: rect.w - 6, h: rowH - 2 };
            const accent = chat.sentiment === 'positive' ? COLORS.POSITIVE : chat.sentiment === 'negative' ? COLORS.NEGATIVE : COLORS.NEUTRAL;
            const player = String(chat.source || '').includes('player');
            render('ui', { shape: 'roundRect', ...row, radius: Math.max(4, row.h * .2), fill: player ? 'rgba(66,224,208,0.18)' : COLORS.GLASS_FILL_STRONG, alpha: .84 });
            render('ui', { shape: 'roundRect', x: row.x + 5, y: row.y + row.h * .25, w: 5, h: row.h * .5, radius: 999, fill: accent });
            const authorW = Math.min(row.w * .31, 96);
            this.#label(chat.author || chat.viewer_id || 'viewer', row.x + 15, row.y + row.h / 2, this.#size(UI.SMALL_FONT_WH), player ? COLORS.DEEP_BLUE : accent, { baseline: 'middle', weight: 900, maxWidth: authorW - 18 });
            this.#label(chat.text, row.x + authorW, row.y + row.h / 2, this.#size(UI.SMALL_FONT_WH), COLORS.INK, { baseline: 'middle', weight: player ? 800 : 650, maxWidth: row.w - authorW - 10, clipRect: row });
        });
    }

    /** 활성 핵심 채팅과 대응 타이머를 그립니다. @private */
    #core() {
        const c = this.context;
        const core = c.snapshot?.activeCoreChat;
        const rect = c.layout.coreCard;
        this.#panel(rect, { fill: core ? 'rgba(255,107,120,0.18)' : COLORS.GLASS_FILL_STRONG, stroke: core ? COLORS.NEGATIVE : COLORS.GLASS_BORDER, lineWidth: core ? 2.5 : 1.2 });
        if (!core) {
            this.#label('핵심 채팅 대기', rect.x + rect.w / 2, rect.y + rect.h * .44, this.#size(UI.BODY_FONT_WH), COLORS.INK_MUTED, { align: 'center', baseline: 'middle', weight: 900 });
            this.#label('등장하면 강퇴·그대로 두기를 결정하세요.', rect.x + rect.w / 2, rect.y + rect.h * .7, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { align: 'center', baseline: 'middle', weight: 650, maxWidth: rect.w * .9 });
            return;
        }
        this.#label(`CORE · ${text(core.author, 24)}`, rect.x + rect.w * .055, rect.y + rect.h * .18, this.#size(UI.SMALL_FONT_WH), COLORS.NEGATIVE, { baseline: 'middle', weight: 950 });
        this.#wrapped(core.text, rect.x + rect.w * .055, rect.y + rect.h * .32, rect.w * .89, this.#size(UI.BODY_FONT_WH), COLORS.INK, 2);
        this.#timer({ x: rect.x + rect.w * .055, y: rect.y + rect.h * .84, w: rect.w * .89, h: Math.max(8, rect.h * .08) }, core.timeRemainingSeconds, c.timerMaximums.core, COLORS.NEGATIVE, '핵심', COLORS.INK);
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
        this.#panel(left, { fill: COLORS.GLASS_FILL_STRONG });
        this.#panel(right, { fill: COLORS.GLASS_FILL_STRONG });
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
            ['시청자 강퇴', `${integer(moderation.kicksUsed ?? s.kicksUsed)}회`, COLORS.NEGATIVE],
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
        render('ui', { shape: 'roundRect', ...intentRect, radius: this.#radius() * .5, fill: 'rgba(66,224,208,0.13)' });
        this.#label(`자유 채팅 판정 · ${integer(playerMessages.used ?? s.playerMessagesUsed)}/3회`, intentRect.x + intentRect.w * .035, intentRect.y + intentRect.h * .25, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { baseline: 'middle', weight: 850 });
        this.#label(intents.map((intent, index) => `${index + 1} ${intent}`).join('  ·  '), intentRect.x + intentRect.w * .035, intentRect.y + intentRect.h * .68, this.#size(UI.BODY_FONT_WH), COLORS.DEEP_BLUE, { baseline: 'middle', weight: 900, maxWidth: intentRect.w * .93 });

        const moments = Array.isArray(result.majorMoments) ? result.majorMoments : [];
        const momentLines = moments.slice(-3).map((item) => text(item.text || item.label || item, 76)).filter(Boolean);
        this.#label('주요 순간', rightX, right.y + right.h * .595, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { baseline: 'middle', weight: 900 });
        const momentFontSize = this.#size(UI.SMALL_FONT_WH);
        momentLines.forEach((line, index) => {
            this.#label(`• ${line}`, rightX, right.y + right.h * .625 + index * momentFontSize * 1.28, momentFontSize, COLORS.INK, { weight: 750, maxWidth: rightW });
        });
        const heroRect = { x: rightX, y: right.y + right.h * .785, w: rightW, h: right.h * .15 };
        render('ui', { shape: 'roundRect', ...heroRect, radius: this.#radius() * .55, fill: COLORS.DARK_GLASS });
        this.#label('히로인의 한마디', heroRect.x + heroRect.w * .035, heroRect.y + heroRect.h * .25, this.#size(UI.SMALL_FONT_WH), COLORS.AQUA, { baseline: 'middle', weight: 900 });
        this.#wrapped(result.heroComment || '다음 방송에서도 함께해 줘.', heroRect.x + heroRect.w * .035, heroRect.y + heroRect.h * .47, heroRect.w * .93, this.#size(UI.BODY_FONT_WH), COLORS.GLASS_WHITE, 2);
        this.#button(c.resultRestartButton, '같은 주제 재방송', COLORS.DEEP_BLUE, COLORS.GLASS_BORDER, COLORS.GLASS_WHITE);
        this.#button(c.resultTopicsButton, '다른 주제 선택', COLORS.GLASS_FILL_STRONG, COLORS.DEEP_BLUE, COLORS.DEEP_BLUE);
    }

    /** 결과 화면의 짧은 라벨과 값을 한 행 또는 카드로 그립니다. @private */
    #resultStat(label, value, rect, color = COLORS.DEEP_BLUE, stacked = false) {
        render('ui', { shape: 'roundRect', ...rect, radius: this.#radius() * .45, fill: 'rgba(95,203,255,0.13)' });
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
        render('ui', { shape: 'rect', x: 0, y: 0, w: c.WW, h: c.WH, fill: COLORS.DARK_GLASS, alpha: .78 });
        const rect = c.layout.modal;
        this.#panel(rect, { fill: COLORS.GLASS_FILL_STRONG, stroke: COLORS.WARNING, lineWidth: 2.5 });
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
        const width = Math.min(c.UIWW * .66, Math.max(260, measureText(c.toastText, font) + 54));
        const rect = { x: c.UIOffsetX + (c.UIWW - width) / 2, y: c.mode === 'live' ? c.WH * .91 : c.WH * .89, w: width, h: Math.max(42, c.WH * .062) };
        const alpha = clamp(c.toastSecondsRemaining * 2, 0, 1);
        render('ui', { shape: 'roundRect', ...rect, radius: 999, fill: COLORS.DARK_GLASS, stroke: COLORS.AQUA, lineWidth: 1.5, alpha });
        this.#label(c.toastText, rect.x + rect.w / 2, rect.y + rect.h / 2, this.#size(UI.BODY_FONT_WH), COLORS.GLASS_WHITE, { align: 'center', baseline: 'middle', weight: 850, maxWidth: rect.w - 36, alpha });
    }

    /** 상태 게이지를 그립니다. @private */
    #meter(label, value, color, rect, opinion = false) {
        const numeric = number(value);
        const percent = opinion ? clamp((numeric + 100) / 2, 0, 100) : clamp(numeric, 0, 100);
        const shown = opinion ? `${numeric > 0 ? '+' : ''}${Math.round(numeric)}` : `${Math.round(numeric)}%`;
        this.#label(label, rect.x, rect.y + rect.h * .28, this.#size(UI.SMALL_FONT_WH), COLORS.INK_MUTED, { baseline: 'middle', weight: 800 });
        this.#label(shown, rect.x + rect.w, rect.y + rect.h * .28, this.#size(UI.METRIC_FONT_WH), color, { align: 'right', baseline: 'middle', weight: 950 });
        const bar = { x: rect.x, y: rect.y + rect.h * .58, w: rect.w, h: Math.max(6, rect.h * .16) };
        render('ui', { shape: 'roundRect', ...bar, radius: 999, fill: COLORS.DARK_GLASS_SOFT, alpha: .36 });
        if (percent > 0) render('ui', { shape: 'roundRect', x: bar.x, y: bar.y, w: Math.max(bar.h, bar.w * percent / 100), h: bar.h, radius: 999, fill: color });
    }

    /** 가독성 높은 수평 카운트다운을 그립니다. @private */
    #timer(rect, remaining, maximum, color, label, labelColor = COLORS.GLASS_WHITE) {
        const left = Math.max(0, number(remaining));
        const max = Math.max(.001, number(maximum, left || 1));
        const ratio = clamp(left / max, 0, 1);
        render('ui', { shape: 'roundRect', ...rect, radius: 999, fill: COLORS.DARK_GLASS_SOFT, alpha: .7 });
        if (ratio > 0) render('ui', { shape: 'roundRect', x: rect.x, y: rect.y, w: Math.max(rect.h, rect.w * ratio), h: rect.h, radius: 999, fill: color });
        this.#label(`${label} · ${Math.ceil(left)}초${this.context.inputClassificationPending ? ' · PAUSE' : ''}`, rect.x + rect.w, rect.y - Math.max(5, rect.h * .55), this.#size(UI.SMALL_FONT_WH), labelColor, { align: 'right', baseline: 'bottom', weight: 900, maxWidth: rect.w });
    }

    /** 풀링 버튼 상태를 사용자 정의 Canvas 버튼으로 그립니다. @private */
    #button(button, label, fill, stroke, textColor, disabled = false) {
        if (!button?.visible) return;
        const rect = this.#buttonRect(button);
        render('ui', { shape: 'roundRect', ...rect, radius: Math.min(this.#radius() * .65, rect.h * .32), fill: disabled ? COLORS.DARK_GLASS_SOFT : fill, stroke, lineWidth: 1.5, alpha: disabled ? .45 : .96 });
        if (!disabled && button.hoverValue > .01) render('ui', { shape: 'roundRect', ...rect, radius: Math.min(this.#radius() * .65, rect.h * .32), fill: COLORS.GLASS_WHITE, alpha: button.hoverValue * .16 });
        this.#label(label, rect.x + rect.w / 2, rect.y + rect.h / 2, Math.min(this.#size(UI.BODY_FONT_WH), rect.h * .34), textColor, { align: 'center', baseline: 'middle', weight: 900, maxWidth: rect.w * .9, alpha: disabled ? .55 : 1 });
    }

    /** 유리 패널을 그립니다. @private */
    #panel(rect, style = {}) {
        const radius = this.#radius();
        render('ui', { shape: 'roundRect', x: rect.x + 3, y: rect.y + 5, w: rect.w, h: rect.h, radius, fill: COLORS.GLASS_SHADOW, alpha: .48 });
        render('ui', { shape: 'roundRect', ...rect, radius, fill: style.fill || COLORS.GLASS_FILL, stroke: style.stroke || COLORS.GLASS_BORDER, lineWidth: style.lineWidth || 1.2, alpha: style.alpha ?? .96 });
    }

    /** 한 줄 Canvas 텍스트를 폭에 맞춰 그립니다. @private */
    #label(value, x, y, size, color, options = {}) {
        const font = createFontString({ weight: options.weight || 600, sizePx: size, family: FONT_FAMILY });
        const safe = text(value, 500);
        const shown = Number.isFinite(options.maxWidth)
            ? truncateTextToWidth(safe, { maxWidth: options.maxWidth, measureWidth: (candidate) => measureText(candidate, font), ellipsis: '…' })
            : safe;
        render('ui', {
            shape: 'text', text: shown, x, y, font, fill: color, align: options.align || 'left',
            baseline: options.baseline || 'top', alpha: options.alpha ?? 1, clipRect: options.clipRect
        });
    }

    /** 여러 줄 Canvas 텍스트를 문자 단위로 감싸 그립니다. @private */
    #wrapped(value, x, y, width, size, color, maxLines = 3, align = 'left') {
        const font = createFontString({ weight: 750, sizePx: size, family: FONT_FAMILY });
        const lines = wrapTextByCharacters(text(value, 600), { maxWidth: width, maxLines, measureWidth: (candidate) => measureText(candidate, font) });
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
        render('ui', {
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
