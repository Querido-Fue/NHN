import { BaseScene } from 'scene/_base_scene.js';
import { getData } from 'data/data_handler.js';
import { getUIOffsetX, getUIWW, getWH, getWW } from 'display/display_system.js';
import { getDelta } from 'engine/time_handler.js';
import { getKeyboardCodeInput } from 'input/input_system.js';
import { UIPool, releaseUIItem } from 'ui/_ui_pool.js';
import {
    AERO_LIVE_DEFAULT_TIMING,
    AERO_LIVE_VIEWER_IDS
} from './_aero_live_content.mjs';
import { AeroLiveCampaign } from './_aero_live_campaign.mjs';
import { AeroLiveRuntime } from './_aero_live_runtime.mjs';
import { AeroLiveAiService } from './_aero_live_ai_service.js';
import { buildVisibleChatRows } from './_aero_live_chat_layout.mjs';
import { AeroLiveDomComposer } from './_aero_live_dom_composer.js';
import { AeroLiveNicknameComposer } from './_aero_live_nickname_composer.js';
import {
    AERO_LIVE_PLAYER_NAME_TOKEN,
    replaceAeroLivePlayerNameForModel,
    validateAeroLivePlayerName
} from './_aero_live_player_identity.mjs';
import { AeroLiveRenderer } from './_aero_live_renderer.js';

const AERO_CONSTANTS = getData('AERO_LIVE_SCENE_CONSTANTS');
const UI = AERO_CONSTANTS.UI;
const COLORS = AERO_CONSTANTS.COLORS;
const TRANSPARENT = 'rgba(255,255,255,0)';
const MODE_NICKNAME = 'nickname';
const MODE_TOPIC_SELECT = 'topicSelect';
const MODE_LIVE = 'live';
const MODE_RESULTS = 'results';
const HERO_RESPONSE_SECONDS = 5.8;
const ECHO_MEMORY_LIMIT = 3;
const HERO_EXPRESSIONS = new Set([
    'idle',
    'happy',
    'angry',
    'sad',
    'shocked',
    'embarrassed'
]);
const AMBIENT_CHAT_START_DELAY_SECONDS = 0.6;
const AMBIENT_CHAT_INTERVAL_SECONDS = 1.25;
const AMBIENT_EVENT_TRANSITION_IDLE_SECONDS = 0.6;
const AMBIENT_RECENT_AUTHOR_WINDOW = 9;
const AMBIENT_INITIAL_AHA_BURST_COUNT = 8;
const AMBIENT_INITIAL_AHA_TEXT = '아하';
const AMBIENT_BRIDGE_TEXTS = Object.freeze([
    '뭣',
    '헉',
    'ㄹㅇ인가',
    '오늘 폼 좋다 ㅋㅋ',
    '그건...',
    '너 좋다 너 잘한다',
    '대회 나감?',
    '심어주고~',
    '대화가 된다',
    '아쉬운 거지',
    'ㅋㅋㅋㅋ',
    '이건 인정',
    '다음 장면 드가자',
    '방금 뭐였지?',
    '오 이 흐름 좋다',
    '잠깐만 다시 보자',
    '채팅도 집중 중',
    '다음 얘기 궁금함'
]);
const CORE_ACTIONS = Object.freeze([
    Object.freeze({ id: 'kick', label: '강퇴', color: COLORS.NEGATIVE }),
    Object.freeze({ id: 'delete', label: '삭제', color: COLORS.WARNING }),
    Object.freeze({ id: 'ignore', label: '무시', color: COLORS.NEUTRAL })
]);

/**
 * 알 수 없는 값을 유한한 숫자로 정규화합니다.
 * @param {*} value - 원본 값입니다.
 * @param {number} fallback - 변환 실패 시 사용할 값입니다.
 * @returns {number} 유한한 숫자입니다.
 */
function finiteNumber(value, fallback = 0) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

/**
 * 런타임 옵션 또는 제품 기본값으로 타이머 표시 상한을 만듭니다.
 * @param {object} [runtimeOptions={}] - AeroLiveRuntime 생성 옵션입니다.
 * @returns {{core:number,donation:number}} 대응 타이머 상한입니다.
 */
function createTimerMaximums(runtimeOptions = {}) {
    const core = finiteNumber(
        runtimeOptions?.timing?.coreChatSeconds,
        AERO_LIVE_DEFAULT_TIMING.coreChatSeconds
    );
    const donation = finiteNumber(
        runtimeOptions?.timing?.donationSeconds,
        AERO_LIVE_DEFAULT_TIMING.donationSeconds
    );
    return {
        core: core > 0 ? core : AERO_LIVE_DEFAULT_TIMING.coreChatSeconds,
        donation: donation > 0 ? donation : AERO_LIVE_DEFAULT_TIMING.donationSeconds
    };
}

/**
 * 모델 또는 런타임 문자열을 Canvas에 안전하게 표시할 문자열로 바꿉니다.
 * @param {*} value - 원본 값입니다.
 * @param {number} [maxChars=240] - 허용할 최대 코드포인트 수입니다.
 * @returns {string} 정리된 문자열입니다.
 */
function safeText(value, maxChars = 240) {
    return Array.from(String(value ?? '')
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim())
        .slice(0, maxChars)
        .join('');
}

/**
 * 렌더 사각형의 안전한 복사본을 만듭니다.
 * @param {{x:number,y:number,w:number,h:number}} rect - 원본 사각형입니다.
 * @returns {{x:number,y:number,w:number,h:number}} 복사된 사각형입니다.
 */
function copyRect(rect) {
    return {
        x: finiteNumber(rect?.x, 0),
        y: finiteNumber(rect?.y, 0),
        w: Math.max(0, finiteNumber(rect?.w, 0)),
        h: Math.max(0, finiteNumber(rect?.h, 0))
    };
}

/**
 * 닉네임과 겹치지 않는 모델 전용 시청자 ID를 결정론적으로 만듭니다.
 * @param {string} playerName - 로컬 플레이어 닉네임입니다.
 * @param {number} [count=3] - 필요한 ID 개수입니다.
 * @returns {string[]} ASCII 시청자 ID 목록입니다.
 */
function createPrivateViewerIds(playerName, count = 3) {
    const playerNameKey = safeText(playerName, 24).toLocaleLowerCase('ko-KR');
    const prefixes = ['v', 'q', 'z', 'm'];
    const viewerIds = [];
    for (let sequence = 1; viewerIds.length < count && sequence < 4096; sequence += 1) {
        const prefix = prefixes[sequence % prefixes.length];
        const candidate = `${prefix}${sequence.toString(36).padStart(3, '0')}`;
        if (!playerNameKey || !replaceAeroLivePlayerNameForModel(
            candidate,
            playerName
        ).includes(AERO_LIVE_PLAYER_NAME_TOKEN)) {
            viewerIds.push(candidate);
        }
    }
    return viewerIds;
}

/**
 * AERO LIVE의 주제 선택, 방송, 결과 화면을 하나의 수명주기에서 관리합니다.
 */
export class AeroLiveScene extends BaseScene {
    /**
     * @param {object} sceneSystem - 엔진 씬 시스템입니다.
     * @param {{runtime?:AeroLiveRuntime,aiService?:AeroLiveAiService,runtimeOptions?:object,topicId?:string,playerName?:string}} [options={}] - 테스트 및 직접 진입 옵션입니다.
     */
    constructor(sceneSystem, options = {}) {
        super(sceneSystem);
        this.options = options || {};
        this.isDestroyed = false;
        const initialPlayerName = validateAeroLivePlayerName(this.options.playerName);
        this.playerName = initialPlayerName.valid ? initialPlayerName.name : '';
        this.mode = this.playerName ? MODE_TOPIC_SELECT : MODE_NICKNAME;
        this.pendingTopicId = typeof this.options.topicId === 'string'
            ? safeText(this.options.topicId, 80)
            : '';
        this.nicknameInvalid = false;
        this.earlyEndModalOpen = false;
        this.inputClassificationPending = false;
        this.asyncGeneration = 0;
        this.intentContextRevision = 0;
        this.elapsedVisualSeconds = 0;
        this.toastText = '';
        this.toastSecondsRemaining = 0;
        this.heroResponseText = '';
        this.heroResponseSecondsRemaining = 0;
        this.heroResponseLabel = '';
        this.heroResponseExpression = 'idle';
        this.echoMemories = [];
        this.pendingEchoCallback = null;
        this.ambientChatQueue = [];
        this.ambientChatBeatId = null;
        this.ambientChatSecondsRemaining = 0;
        this.ambientBridgeSequence = 0;
        this.ambientReservedViewerIds = new Set();
        this.keyLatch = new Map();
        this.buttons = [];
        this.topicButtons = [];
        this.coreButtons = [];
        this.coreRowButtons = [];
        this.donationButtons = [];
        this.visibleChatRows = [];
        this.coreRowButtonSignature = '';
        this.selectedCoreChatId = null;
        this.runtimeOptions = this.options.runtimeOptions || {};
        this.timerMaximums = createTimerMaximums(this.runtimeOptions);
        this.campaign = this.options.campaign || new AeroLiveCampaign({
            initialMetrics: this.runtimeOptions.initialMetrics
        });
        this.injectedRuntimePending = Boolean(this.options.runtime);
        this.runtime = this.options.runtime || new AeroLiveRuntime(this.runtimeOptions);
        this.aiService = this.options.aiService || new AeroLiveAiService();
        this.snapshot = this.runtime.getSnapshot();
        this.topicSummaries = this.runtime.getTopicSummaries();
        this.renderer = new AeroLiveRenderer();
        this.#syncViewport();
        this.composer = new AeroLiveDomComposer({
            onSubmit: (message) => this.#submitPlayerMessage(message),
            onEscape: () => {
                if (this.earlyEndModalOpen) this.#closeEarlyEndModal();
                else this.#openEarlyEndModal();
            }
        });
        this.nicknameComposer = new AeroLiveNicknameComposer({
            onSubmit: (name) => this.#submitNickname(name)
        });
        this.#syncButtonStates();
        this.#syncComposerDom();
        if (this.playerName && this.pendingTopicId) {
            const topicId = this.pendingTopicId;
            this.pendingTopicId = '';
            this.#startBroadcast(topicId);
        }
    }

    /**
     * 가변 프레임 UI, 키보드 입력과 비동기 상태 표시를 갱신합니다.
     * @override
     */
    update() {
        if (this.isDestroyed) {
            return;
        }

        const deltaSeconds = Math.max(0, finiteNumber(getDelta(), 0));
        this.elapsedVisualSeconds += deltaSeconds;
        this.toastSecondsRemaining = Math.max(0, this.toastSecondsRemaining - deltaSeconds);
        if (this.toastSecondsRemaining <= 0) {
            this.toastText = '';
        }
        this.heroResponseSecondsRemaining = Math.max(0, this.heroResponseSecondsRemaining - deltaSeconds);
        if (this.heroResponseSecondsRemaining <= 0) {
            this.heroResponseText = '';
            this.heroResponseLabel = '';
            this.heroResponseExpression = 'idle';
        }

        this.#handleKeyboardInput();
        this.#syncSnapshotState();
        this.#syncButtonStates();
        for (const button of [...this.buttons]) {
            if (this.buttons.includes(button) && button.visible) {
                button.update();
            }
        }
        this.#syncComposerDom();
    }

    /**
     * 고정 틱에서 결정론적 방송 런타임을 진행합니다.
     * @override
     */
    fixedUpdate() {
        if (this.isDestroyed || this.mode !== MODE_LIVE || this.snapshot?.status !== 'live') {
            return;
        }

        const fixedStepSeconds = 1 / 60;
        this.snapshot = this.runtime.fixedUpdate(fixedStepSeconds, {
            pauseEventTimers: this.inputClassificationPending
        });
        this.#consumeRuntimeEvents();
        this.#advanceAmbientChatQueue(fixedStepSeconds);
        this.#syncSnapshotState();
    }

    /**
     * 현재 내부 모드에 맞는 Canvas 화면을 그립니다.
     * @override
     */
    draw() {
        if (this.isDestroyed) {
            return;
        }
        this.renderer.draw(this.#buildRenderContext());
    }

    /**
     * 히로인 이미지가 준비되거나 로드 실패가 확정될 때까지 전환 준비를 기다립니다.
     * @returns {Promise<void>} 이미지 준비 대기 Promise입니다.
     * @override
     */
    whenReadyForTransition() {
        return this.renderer?.whenReady?.() || Promise.resolve();
    }

    /**
     * 창 크기 변경에 맞춰 Canvas 및 DOM 레이아웃을 다시 계산합니다.
     * @override
     */
    resize() {
        if (this.isDestroyed) {
            return;
        }
        this.#syncViewport();
        this.#syncButtonStates();
        this.#syncComposerDom();
    }

    /**
     * 비동기 요청, DOM 요소와 풀링 UI를 모두 정리합니다.
     * @override
     */
    destroy() {
        if (this.isDestroyed) {
            return;
        }

        this.isDestroyed = true;
        this.asyncGeneration += 1;
        this.#clearAmbientChatQueue();
        this.aiService?.destroy?.();
        this.#releaseButtons();
        this.composer?.destroy?.();
        this.nicknameComposer?.destroy?.();
        this.renderer?.destroy?.();
        this.composer = null;
        this.nicknameComposer = null;
        this.renderer = null;
        this.snapshot = null;
    }

    /**
     * Renderer에 전달할 현재 Scene의 읽기 전용 표현 컨텍스트를 구성합니다.
     * @returns {object} 한 프레임의 표현 상태입니다.
     * @private
     */
    #buildRenderContext() {
        return {
            WW: this.WW,
            WH: this.WH,
            UIWW: this.UIWW,
            UIOffsetX: this.UIOffsetX,
            mode: this.mode,
            playerName: this.playerName,
            nicknameInvalid: this.nicknameInvalid,
            layout: this.layout,
            snapshot: this.snapshot,
            topicSummaries: this.topicSummaries,
            topicButtons: this.topicButtons,
            coreButtons: this.coreButtons,
            visibleChatRows: this.visibleChatRows,
            selectedCoreChatId: this.selectedCoreChatId,
            donationButtons: this.donationButtons,
            endButton: this.endButton,
            modalCancelButton: this.modalCancelButton,
            modalConfirmButton: this.modalConfirmButton,
            resultRestartButton: this.resultRestartButton,
            resultTopicsButton: this.resultTopicsButton,
            earlyEndModalOpen: this.earlyEndModalOpen,
            inputClassificationPending: this.inputClassificationPending,
            elapsedVisualSeconds: this.elapsedVisualSeconds,
            timerMaximums: this.timerMaximums,
            toastText: this.toastText,
            toastSecondsRemaining: this.toastSecondsRemaining,
            heroResponseText: this.heroResponseText,
            heroResponseLabel: this.heroResponseLabel,
            heroResponseExpression: this.heroResponseExpression,
            echoMemories: this.echoMemories.map((memory) => ({ ...memory })),
            aiStatus: this.aiService?.getStatus?.() || 'AI 준비',
            campaign: this.campaign?.getSnapshot?.() || null
        };
    }

    /**
     * 현재 디스플레이 크기를 읽고 모든 화면 사각형을 구성합니다.
     * @private
     */
    #syncViewport() {
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();

        const ux = (percent) => this.UIWW * (percent / 100);
        const vy = (percent) => this.WH * (percent / 100);
        const safe = ux(UI.SAFE_MARGIN_UIWW);
        const gap = ux(UI.PANEL_GAP_UIWW);
        const contentX = this.UIOffsetX + safe;
        const contentW = Math.max(1, this.UIWW - (safe * 2));
        const topH = vy(UI.TOP_BAR_HEIGHT_WH);
        const bodyY = safe + topH + gap;
        const bodyH = Math.max(1, this.WH - bodyY - safe);
        const columnsW = Math.max(1, contentW - (gap * 2));
        const ratioSum = UI.LEFT_COLUMN_RATIO + UI.CENTER_COLUMN_RATIO + UI.RIGHT_COLUMN_RATIO;
        const leftW = columnsW * (UI.LEFT_COLUMN_RATIO / ratioSum);
        const centerW = columnsW * (UI.CENTER_COLUMN_RATIO / ratioSum);
        const rightW = Math.max(1, columnsW - leftW - centerW);
        const leftX = contentX;
        const centerX = leftX + leftW + gap;
        const rightX = centerX + centerW + gap;
        const panelPad = ux(UI.PANEL_PADDING_UIWW);
        const composerH = vy(UI.DOM_INPUT_HEIGHT_WH);
        const coreActionH = vy(UI.CORE_ACTION_HEIGHT_WH);
        const donationActionH = vy(UI.DONATION_ACTION_HEIGHT_WH);

        this.layout = {
            safe,
            gap,
            panelPad,
            topBar: { x: contentX, y: safe, w: contentW, h: topH },
            left: { x: leftX, y: bodyY, w: leftW, h: bodyH },
            center: { x: centerX, y: bodyY, w: centerW, h: bodyH },
            right: { x: rightX, y: bodyY, w: rightW, h: bodyH }
        };

        const endButtonW = Math.max(84, ux(7.8));
        this.layout.endButton = {
            x: contentX + contentW - endButtonW - panelPad * 0.45,
            y: safe + (topH * 0.2),
            w: endButtonW,
            h: topH * 0.6
        };

        const leftInnerX = leftX + panelPad;
        const leftInnerW = Math.max(1, leftW - (panelPad * 2));
        const donationCardH = Math.max(vy(14), 92);
        this.layout.donationCard = {
            x: leftInnerX,
            y: bodyY + panelPad * 2.2,
            w: leftInnerW,
            h: donationCardH
        };
        const donationButtonsTotalH = (donationActionH * AERO_CONSTANTS.INSTRUCTIONS.length)
            + (gap * 0.48 * Math.max(0, AERO_CONSTANTS.INSTRUCTIONS.length - 1));
        const donationButtonsY = bodyY + bodyH - panelPad - donationButtonsTotalH;
        this.layout.donationActionRects = AERO_CONSTANTS.INSTRUCTIONS.map((instruction, index) => ({
            id: instruction.id,
            x: leftInnerX,
            y: donationButtonsY + (index * (donationActionH + gap * 0.48)),
            w: leftInnerW,
            h: donationActionH
        }));
        this.layout.metricArea = {
            x: leftInnerX,
            y: this.layout.donationCard.y + donationCardH + gap,
            w: leftInnerW,
            h: Math.max(0, donationButtonsY - gap - (this.layout.donationCard.y + donationCardH + gap))
        };

        const centerInner = {
            x: centerX + panelPad,
            y: bodyY + panelPad,
            w: Math.max(1, centerW - panelPad * 2),
            h: Math.max(1, bodyH - panelPad * 2)
        };
        const dialogueH = vy(UI.HERO_DIALOGUE_HEIGHT_WH);
        this.layout.heroStage = {
            x: centerInner.x,
            y: centerInner.y,
            w: centerInner.w,
            h: Math.max(1, centerInner.h - dialogueH - gap)
        };
        this.layout.heroDialogue = {
            x: centerInner.x,
            y: centerInner.y + centerInner.h - dialogueH,
            w: centerInner.w,
            h: dialogueH
        };

        const rightInnerX = rightX + panelPad;
        const rightInnerW = Math.max(1, rightW - panelPad * 2);
        this.layout.composer = {
            x: rightInnerX,
            y: bodyY + bodyH - panelPad - composerH,
            w: rightInnerW,
            h: composerH
        };
        const coreActionsY = this.layout.composer.y - gap - coreActionH;
        const coreButtonGap = gap * 0.45;
        const coreButtonCount = Math.max(1, CORE_ACTIONS.length);
        const coreButtonW = (rightInnerW - coreButtonGap * Math.max(0, coreButtonCount - 1)) / coreButtonCount;
        this.layout.coreActionRects = CORE_ACTIONS.map((action, index) => ({
            id: action.id,
            x: rightInnerX + index * (coreButtonW + coreButtonGap),
            y: coreActionsY,
            w: coreButtonW,
            h: coreActionH
        }));
        this.layout.chatArea = {
            x: rightInnerX,
            y: bodyY + panelPad + vy(4.6),
            w: rightInnerW,
            h: Math.max(1, coreActionsY - gap - (bodyY + panelPad + vy(4.6)))
        };

        this.#buildTopicLayout();
        this.#buildModalAndResultLayout();
        this.#rebuildButtons();
    }

    /**
     * 주제 선택 카드 사각형을 현재 안전 영역에 맞춰 계산합니다.
     * @private
     */
    #buildTopicLayout() {
        const gap = this.UIWW * (UI.TOPIC_CARD_GAP_UIWW / 100);
        const safe = this.layout.safe;
        const contentX = this.UIOffsetX + safe;
        const contentW = this.UIWW - safe * 2;
        const cardCount = Math.max(1, this.topicSummaries.length);
        const cardW = Math.max(1, (contentW - gap * (cardCount - 1)) / cardCount);
        const cardH = this.WH * (UI.TOPIC_CARD_HEIGHT_WH / 100);
        const cardY = this.WH * 0.335;
        this.layout.topicCards = this.topicSummaries.map((topic, index) => ({
            id: topic.id,
            x: contentX + index * (cardW + gap),
            y: cardY,
            w: cardW,
            h: cardH
        }));
    }

    /**
     * 조기 종료 모달과 결과 화면 버튼 사각형을 계산합니다.
     * @private
     */
    #buildModalAndResultLayout() {
        const nicknameW = Math.min(this.UIWW * 0.54, 680);
        const nicknameH = Math.min(this.WH * 0.48, 360);
        const nicknameX = this.UIOffsetX + (this.UIWW - nicknameW) * 0.5;
        const nicknameY = (this.WH - nicknameH) * 0.5;
        const nicknameInputH = Math.max(54, this.WH * 0.082);
        this.layout.nicknamePanel = {
            x: nicknameX,
            y: nicknameY,
            w: nicknameW,
            h: nicknameH
        };
        this.layout.nicknameComposer = {
            x: nicknameX + this.layout.panelPad,
            y: nicknameY + nicknameH - this.layout.panelPad - nicknameInputH,
            w: Math.max(1, nicknameW - this.layout.panelPad * 2),
            h: nicknameInputH
        };

        const modalW = Math.min(this.UIWW * 0.44, 560);
        const modalH = Math.min(this.WH * 0.36, 280);
        const modalX = this.UIOffsetX + (this.UIWW - modalW) * 0.5;
        const modalY = (this.WH - modalH) * 0.5;
        const buttonGap = this.layout.gap;
        const buttonW = (modalW - this.layout.panelPad * 2 - buttonGap) * 0.5;
        const buttonH = Math.max(42, this.WH * 0.067);
        this.layout.modal = { x: modalX, y: modalY, w: modalW, h: modalH };
        this.layout.modalCancel = {
            x: modalX + this.layout.panelPad,
            y: modalY + modalH - this.layout.panelPad - buttonH,
            w: buttonW,
            h: buttonH
        };
        this.layout.modalConfirm = {
            x: modalX + this.layout.panelPad + buttonW + buttonGap,
            y: modalY + modalH - this.layout.panelPad - buttonH,
            w: buttonW,
            h: buttonH
        };

        const resultButtonW = Math.min(220, this.UIWW * 0.18);
        const resultButtonH = Math.max(44, this.WH * 0.071);
        const resultButtonY = this.WH * 0.82;
        this.layout.resultRestart = {
            x: this.UIOffsetX + this.UIWW * 0.5 - resultButtonW - buttonGap * 0.5,
            y: resultButtonY,
            w: resultButtonW,
            h: resultButtonH
        };
        this.layout.resultTopics = {
            x: this.UIOffsetX + this.UIWW * 0.5 + buttonGap * 0.5,
            y: resultButtonY,
            w: resultButtonW,
            h: resultButtonH
        };
    }

    /**
     * 현재 레이아웃을 기준으로 모든 풀링 버튼 히트박스를 다시 만듭니다.
     * @private
     */
    #rebuildButtons() {
        this.#releaseButtons();

        this.topicButtons = this.layout.topicCards.map((rect, index) => {
            const topic = this.topicSummaries[index];
            const button = this.#createHitButton(rect, () => this.#startBroadcast(topic.id));
            button.aeroRole = MODE_TOPIC_SELECT;
            button.aeroData = topic;
            return button;
        });

        this.coreButtons = this.layout.coreActionRects.map((rect, index) => {
            const action = CORE_ACTIONS[index];
            const button = this.#createHitButton(rect, () => this.#resolveCoreChat(action.id));
            button.aeroRole = 'core';
            button.aeroData = action;
            return button;
        });

        this.donationButtons = this.layout.donationActionRects.map((rect, index) => {
            const instruction = AERO_CONSTANTS.INSTRUCTIONS[index];
            const button = this.#createHitButton(rect, () => this.#resolveDonation(instruction.id));
            button.aeroRole = 'donation';
            button.aeroData = instruction;
            return button;
        });

        this.endButton = this.#createHitButton(this.layout.endButton, () => this.#openEarlyEndModal());
        this.endButton.aeroRole = 'end';
        this.modalCancelButton = this.#createHitButton(this.layout.modalCancel, () => this.#closeEarlyEndModal());
        this.modalCancelButton.aeroRole = 'modal';
        this.modalConfirmButton = this.#createHitButton(this.layout.modalConfirm, () => this.#confirmEarlyEnd());
        this.modalConfirmButton.aeroRole = 'modal';
        this.resultRestartButton = this.#createHitButton(this.layout.resultRestart, () => this.#restartBroadcast());
        this.resultRestartButton.aeroRole = MODE_RESULTS;
        this.resultTopicsButton = this.#createHitButton(this.layout.resultTopics, () => this.#returnToTopicSelect());
        this.resultTopicsButton.aeroRole = MODE_RESULTS;
        this.#syncCoreRowButtons(true);
    }

    /**
     * 현재 피드에서 보이는 핵심 채팅 행에만 풀링 클릭 히트박스를 맞춥니다.
     * @param {boolean} [force=false] - 행 구성이 같아도 히트박스를 다시 만들지 여부입니다.
     * @private
     */
    #syncCoreRowButtons(force = false) {
        if (!this.layout?.chatArea) {
            return;
        }

        this.visibleChatRows = buildVisibleChatRows({
            chats: this.snapshot?.chats,
            rect: this.layout.chatArea,
            visibleCount: UI.CHAT_VISIBLE_COUNT,
            preferredLineHeight: this.WH * UI.CHAT_LINE_HEIGHT_WH / 100
        });
        const activeCoreChatId = this.#getActiveCoreChatId();
        const interactiveRows = this.visibleChatRows.filter(({ chat }) => {
            const coreChatId = safeText(chat?.coreChatId, 80);
            return chat?.kind === 'core'
                && chat?.active !== false
                && coreChatId
                && coreChatId === activeCoreChatId;
        });
        const signature = interactiveRows.map(({ chat, rect }) => [
            safeText(chat?.id, 100),
            safeText(chat?.coreChatId, 80),
            rect.x,
            rect.y,
            rect.w,
            rect.h
        ].join(':')).join('|');
        if (!force && signature === this.coreRowButtonSignature) {
            return;
        }

        this.#releaseCoreRowButtons();
        this.coreRowButtonSignature = signature;
        this.coreRowButtons = interactiveRows.map(({ chat, rect }) => {
            const coreChatId = safeText(chat.coreChatId, 80);
            const button = this.#createHitButton(rect, () => this.#toggleCoreChatSelection(coreChatId));
            button.aeroRole = 'core-row';
            button.aeroData = { chat, coreChatId };
            return button;
        });
    }

    /** 보이는 핵심 채팅 행의 풀링 버튼만 반납합니다. @private */
    #releaseCoreRowButtons() {
        if (this.coreRowButtons.length === 0) {
            return;
        }
        const rowButtons = new Set(this.coreRowButtons);
        this.buttons = this.buttons.filter((button) => !rowButtons.has(button));
        for (const button of this.coreRowButtons) {
            releaseUIItem(button);
        }
        this.coreRowButtons = [];
    }

    /**
     * 투명한 풀링 버튼을 생성해 Canvas 사용자 정의 외형의 히트박스로 사용합니다.
     * @param {{x:number,y:number,w:number,h:number}} rect - 버튼 사각형입니다.
     * @param {Function} onClick - 클릭 콜백입니다.
     * @returns {object} 풀에서 가져온 버튼 요소입니다.
     * @private
     */
    #createHitButton(rect, onClick) {
        const button = UIPool.button.get();
        const safeRect = copyRect(rect);
        button.init({
            parent: this,
            layer: 'ui',
            x: safeRect.x,
            y: safeRect.y,
            width: safeRect.w,
            height: safeRect.h,
            radius: 0,
            margin: 0,
            itemSpacing: 0,
            idleColor: TRANSPARENT,
            hoverColor: TRANSPARENT,
            strokeColor: TRANSPARENT,
            hoverStrokeColor: TRANSPARENT,
            lineWidth: 0,
            alpha: 0,
            activateOnPress: true,
            onClick
        });
        button.aeroDisabled = false;
        this.buttons.push(button);
        return button;
    }

    /**
     * 현재 모드와 진행 이벤트에 맞춰 버튼 표시 및 클릭 가능 상태를 갱신합니다.
     * @private
     */
    #syncButtonStates() {
        this.#syncCoreSelection();
        this.#syncCoreRowButtons();
        const live = this.mode === MODE_LIVE && this.snapshot?.status === 'live';
        const interactionLocked = this.earlyEndModalOpen || this.inputClassificationPending;
        const activeCoreChatId = this.#getActiveCoreChatId();
        const coreSelected = live
            && !!activeCoreChatId
            && this.selectedCoreChatId === activeCoreChatId;
        const donationActive = live && !!this.snapshot?.activeDonation;

        for (const button of this.topicButtons) {
            this.#setButtonState(button, this.mode === MODE_TOPIC_SELECT, false);
        }
        for (const button of this.coreButtons) {
            const isKickUnavailable = button.aeroData?.id === 'kick'
                && finiteNumber(this.snapshot?.resources?.kicksRemaining, 0) <= 0;
            this.#setButtonState(button, coreSelected, interactionLocked || isKickUnavailable);
        }
        for (const button of this.coreRowButtons) {
            const rowCoreChatId = safeText(button.aeroData?.coreChatId, 80);
            this.#setButtonState(
                button,
                live && rowCoreChatId === activeCoreChatId,
                interactionLocked
            );
        }
        for (const button of this.donationButtons) {
            this.#setButtonState(button, live, interactionLocked || !donationActive);
        }

        this.#setButtonState(this.endButton, live, interactionLocked);
        this.#setButtonState(this.modalCancelButton, this.earlyEndModalOpen, false);
        this.#setButtonState(this.modalConfirmButton, this.earlyEndModalOpen, false);
        this.#setButtonState(this.resultRestartButton, this.mode === MODE_RESULTS, false);
        this.#setButtonState(this.resultTopicsButton, this.mode === MODE_RESULTS, false);
    }

    /**
     * 버튼 하나의 표시와 비활성 상태를 반영합니다.
     * @param {object|null} button - 대상 버튼입니다.
     * @param {boolean} visible - 표시 여부입니다.
     * @param {boolean} disabled - 비활성 여부입니다.
     * @private
     */
    #setButtonState(button, visible, disabled) {
        if (!button) {
            return;
        }
        button.visible = visible;
        button.clickAble = visible && !disabled;
        button.aeroDisabled = disabled;
    }

    /**
     * Scene이 소유한 모든 UI 요소를 풀에 반납합니다.
     * @private
     */
    #releaseButtons() {
        for (const button of this.buttons) {
            releaseUIItem(button);
        }
        this.buttons = [];
        this.topicButtons = [];
        this.coreButtons = [];
        this.coreRowButtons = [];
        this.donationButtons = [];
        this.visibleChatRows = [];
        this.coreRowButtonSignature = '';
        this.endButton = null;
        this.modalCancelButton = null;
        this.modalConfirmButton = null;
        this.resultRestartButton = null;
        this.resultTopicsButton = null;
    }

    /**
     * DOM Composer를 현재 Canvas 위치와 입력 상태에 맞춥니다.
     * @private
     */
    #syncComposerDom() {
        if (this.composer && this.layout?.composer) {
            const visible = this.mode === MODE_LIVE
                && this.snapshot?.status === 'live'
                && !this.earlyEndModalOpen;
            const messagesRemaining = finiteNumber(this.snapshot?.resources?.playerMessagesRemaining, 0);
            this.composer.sync({
                rect: this.layout.composer,
                visible,
                disabled: !visible || this.inputClassificationPending || messagesRemaining <= 0,
                pending: this.inputClassificationPending,
                messagesRemaining,
                playerName: this.playerName,
                uiWidth: this.UIWW,
                viewportHeight: this.WH
            });
        }

        this.nicknameComposer?.sync?.({
            rect: this.layout?.nicknameComposer,
            visible: this.mode === MODE_NICKNAME,
            invalid: this.nicknameInvalid,
            uiWidth: this.UIWW,
            viewportHeight: this.WH
        });
    }

    /**
     * 시작 화면의 닉네임을 로컬 표시 상태로만 확정합니다.
     * @param {*} rawName - DOM 입력에서 받은 원문입니다.
     * @private
     */
    #submitNickname(rawName) {
        if (this.isDestroyed || this.mode !== MODE_NICKNAME) {
            return;
        }
        const validation = validateAeroLivePlayerName(
            rawName ?? this.nicknameComposer?.getValue?.()
        );
        if (!validation.valid) {
            this.nicknameInvalid = true;
            this.#showToast(validation.reason);
            this.nicknameComposer?.focus?.();
            this.#syncComposerDom();
            return;
        }

        this.playerName = validation.name;
        this.nicknameInvalid = false;
        this.mode = MODE_TOPIC_SELECT;
        this.#syncButtonStates();
        this.#syncComposerDom();
        if (this.pendingTopicId) {
            const topicId = this.pendingTopicId;
            this.pendingTopicId = '';
            this.#startBroadcast(topicId);
            return;
        }
        this.#showToast(`${this.playerName}님, 방송 주제를 선택해 주세요.`);
    }

    /**
     * 숫자키와 Escape의 단발 입력을 현재 모드 동작으로 변환합니다.
     * @private
     */
    #handleKeyboardInput() {
        for (let index = 0; index < 5; index += 1) {
            if (!this.#consumeKeyPress(`Digit${index + 1}`)) {
                continue;
            }
            if (this.mode === MODE_TOPIC_SELECT && this.topicSummaries[index]) {
                this.#startBroadcast(this.topicSummaries[index].id);
            }
        }

        if (!this.#consumeKeyPress('Escape') || this.mode !== MODE_LIVE) {
            return;
        }
        if (this.earlyEndModalOpen) {
            this.#closeEarlyEndModal();
        } else {
            this.#openEarlyEndModal();
        }
    }

    /**
     * KeyboardEvent.code 기반 눌림 전이를 한 번만 소비합니다.
     * @param {string} code - KeyboardEvent.code 값입니다.
     * @returns {boolean} 이번 프레임에 새로 눌렸으면 true입니다.
     * @private
     */
    #consumeKeyPress(code) {
        const pressed = getKeyboardCodeInput(code) === true;
        const wasPressed = this.keyLatch.get(code) === true;
        this.keyLatch.set(code, pressed);
        return pressed && !wasPressed;
    }

    /**
     * 선택한 주제로 새 방송을 시작합니다.
     * @param {string} topicId - 방송 주제 ID입니다.
     * @private
     */
    #startBroadcast(topicId) {
        const safeTopicId = safeText(topicId, 80);
        if (this.isDestroyed || !safeTopicId || this.snapshot?.status === 'live') {
            return;
        }
        if (!this.playerName) {
            this.pendingTopicId = safeTopicId;
            this.mode = MODE_NICKNAME;
            this.#syncButtonStates();
            this.#syncComposerDom();
            return;
        }

        let campaignPrepared = false;
        try {
            const initialMetrics = this.campaign.prepareBroadcast(safeTopicId);
            campaignPrepared = true;
            if (this.injectedRuntimePending && this.snapshot?.status === 'idle') {
                this.injectedRuntimePending = false;
            } else {
                this.#replaceRuntime(initialMetrics);
            }
            this.snapshot = this.runtime.startBroadcast(safeTopicId);
            this.mode = MODE_LIVE;
            this.earlyEndModalOpen = false;
            this.selectedCoreChatId = null;
            this.timerMaximums = createTimerMaximums(this.runtimeOptions);
            this.heroResponseText = '';
            this.heroResponseSecondsRemaining = 0;
            this.heroResponseLabel = '';
            this.heroResponseExpression = 'idle';
            this.echoMemories = [];
            this.pendingEchoCallback = null;
            this.#clearAmbientChatQueue();
            this.#consumeRuntimeEvents();
            this.#syncSnapshotState();
            this.#showToast(`${safeText(this.snapshot?.topic?.title, 40)} 방송을 시작합니다.`);
        } catch (error) {
            if (campaignPrepared) {
                this.campaign.cancelPreparedBroadcast();
            }
            console.warn('[AeroLiveScene] 방송 시작 실패', error);
            this.#showToast('방송을 시작하지 못했습니다. 다른 주제를 선택해 주세요.');
        }
    }

    /**
     * 현재 주제로 런타임을 초기화해 다시 방송합니다.
     * @private
     */
    #restartBroadcast() {
        const topicId = this.snapshot?.topic?.id || this.snapshot?.result?.topic?.id;
        if (!topicId) {
            this.#returnToTopicSelect();
            return;
        }
        this.#startBroadcast(topicId);
    }

    /**
     * 새 런타임으로 교체하고 주제 선택 화면으로 돌아갑니다.
     * @private
     */
    #returnToTopicSelect() {
        this.#replaceRuntime();
        this.mode = MODE_TOPIC_SELECT;
        this.earlyEndModalOpen = false;
        this.#syncButtonStates();
        this.#syncComposerDom();
    }

    /**
     * 진행 중인 AI 요청을 취소하고 깨끗한 방송 런타임을 만듭니다.
     * @private
     */
    #replaceRuntime(initialMetrics = null) {
        this.asyncGeneration += 1;
        this.intentContextRevision += 1;
        this.aiService?.abortAll?.();
        this.inputClassificationPending = false;
        this.selectedCoreChatId = null;
        this.heroResponseText = '';
        this.heroResponseSecondsRemaining = 0;
        this.heroResponseLabel = '';
        this.heroResponseExpression = 'idle';
        this.echoMemories = [];
        this.pendingEchoCallback = null;
        this.#clearAmbientChatQueue();
        const nextRuntimeOptions = initialMetrics
            ? {
                ...this.runtimeOptions,
                initialMetrics: {
                    ...(this.runtimeOptions.initialMetrics || {}),
                    ...initialMetrics
                }
            }
            : this.runtimeOptions;
        this.runtime = new AeroLiveRuntime(nextRuntimeOptions);
        this.injectedRuntimePending = false;
        this.snapshot = this.runtime.getSnapshot();
        const previousIds = this.topicSummaries.map((topic) => topic.id).join('|');
        this.topicSummaries = this.runtime.getTopicSummaries();
        const nextIds = this.topicSummaries.map((topic) => topic.id).join('|');
        if (previousIds !== nextIds) {
            this.#syncViewport();
        }
    }

    /** @returns {string} 현재 활성 핵심 채팅의 안정적인 ID입니다. @private */
    #getActiveCoreChatId() {
        return safeText(
            this.snapshot?.activeCoreChat?.coreChatId || this.snapshot?.activeCoreChat?.id,
            80
        );
    }

    /** 활성 핵심 채팅이 바뀌거나 사라지면 이전 행 선택을 해제합니다. @private */
    #syncCoreSelection() {
        const activeCoreChatId = this.#getActiveCoreChatId();
        if (!activeCoreChatId
            || (this.selectedCoreChatId && this.selectedCoreChatId !== activeCoreChatId)) {
            this.selectedCoreChatId = null;
        }
    }

    /**
     * 피드 안의 활성 핵심 채팅 행을 선택하거나 같은 행 선택을 해제합니다.
     * @param {string} coreChatId - 피드 행이 가리키는 핵심 채팅 ID입니다.
     * @private
     */
    #toggleCoreChatSelection(coreChatId) {
        if (this.mode !== MODE_LIVE || this.earlyEndModalOpen || this.inputClassificationPending) {
            return;
        }
        const safeCoreChatId = safeText(coreChatId, 80);
        if (!safeCoreChatId || safeCoreChatId !== this.#getActiveCoreChatId()) {
            this.selectedCoreChatId = null;
            this.#syncButtonStates();
            return;
        }
        this.selectedCoreChatId = this.selectedCoreChatId === safeCoreChatId
            ? null
            : safeCoreChatId;
        this.#syncButtonStates();
    }

    /**
     * 선택한 핵심 채팅에 강퇴, 삭제 또는 무시 행동을 적용합니다.
     * @param {'kick'|'delete'|'ignore'} action - 핵심 채팅 대응 행동입니다.
     * @private
     */
    #resolveCoreChat(action) {
        if (this.mode !== MODE_LIVE || this.earlyEndModalOpen || this.inputClassificationPending) {
            return;
        }
        if (!this.selectedCoreChatId || this.selectedCoreChatId !== this.#getActiveCoreChatId()) {
            this.#showToast('처리할 핵심 채팅을 먼저 선택해 주세요.');
            return;
        }
        const response = this.runtime.resolveCoreChat(action);
        if (response?.accepted) {
            this.selectedCoreChatId = null;
        }
        this.#refreshRuntimeState();
        if (!response?.accepted) {
            this.#showToast(response?.reason || '지금은 해당 채팅을 처리할 수 없습니다.');
            return;
        }
        const label = CORE_ACTIONS.find((item) => item.id === action)?.label || '처리';
        this.#showToast(`핵심 채팅을 ${label}했습니다.`);
    }

    /**
     * 활성 후원 요청에 선택한 방송 지시를 적용합니다.
     * @param {string} instructionId - 다섯 후원 지시 중 하나의 ID입니다.
     * @private
     */
    #resolveDonation(instructionId) {
        if (this.mode !== MODE_LIVE || this.earlyEndModalOpen || this.inputClassificationPending) {
            return;
        }
        const response = this.runtime.resolveDonation(instructionId);
        this.#refreshRuntimeState();
        if (!response?.accepted) {
            this.#showToast(response?.reason || '지금은 후원 지시를 내릴 수 없습니다.');
            return;
        }
        const label = AERO_CONSTANTS.INSTRUCTIONS.find((item) => item.id === instructionId)?.shortLabel
            || instructionId;
        this.#showToast(`후원 대응: ${label}`);
    }

    /**
     * 조기 종료 확인 모달을 엽니다.
     * @private
     */
    #openEarlyEndModal() {
        if (this.mode !== MODE_LIVE
            || this.snapshot?.status !== 'live'
            || this.inputClassificationPending) {
            return;
        }
        this.earlyEndModalOpen = true;
        this.#syncButtonStates();
        this.#syncComposerDom();
    }

    /**
     * 조기 종료 확인 모달을 닫습니다.
     * @private
     */
    #closeEarlyEndModal() {
        this.earlyEndModalOpen = false;
        this.#syncButtonStates();
        this.#syncComposerDom();
    }

    /**
     * 확인된 조기 종료 요청을 런타임에 전달합니다.
     * @private
     */
    #confirmEarlyEnd() {
        if (!this.earlyEndModalOpen) {
            return;
        }
        const response = this.runtime.requestEarlyEnd();
        this.earlyEndModalOpen = false;
        this.#refreshRuntimeState();
        if (!response?.accepted) {
            this.#showToast(response?.reason || '지금은 방송을 종료할 수 없습니다.');
        }
    }

    /**
     * DOM textarea의 자유 채팅을 AI로 분류하고 런타임 효과로 확정합니다.
     * @param {string} [rawMessage] - Composer가 전달한 원문입니다.
     * @returns {Promise<void>} 분류와 반영 완료 Promise입니다.
     * @private
     */
    async #submitPlayerMessage(rawMessage) {
        if (this.isDestroyed
            || this.mode !== MODE_LIVE
            || this.snapshot?.status !== 'live'
            || this.earlyEndModalOpen
            || this.inputClassificationPending) {
            return;
        }

        const maxChars = AERO_CONSTANTS.AI.PLAYER_MESSAGE_MAX_CHARS;
        const message = safeText(rawMessage ?? this.composer?.getValue(), maxChars);
        if (!message) {
            this.#showToast('전송할 채팅을 입력해 주세요.');
            return;
        }
        if (finiteNumber(this.snapshot?.resources?.playerMessagesRemaining, 0) <= 0) {
            this.#showToast('이번 방송의 자유 채팅을 모두 사용했습니다.');
            return;
        }

        this.inputClassificationPending = true;
        this.#syncButtonStates();
        this.#syncComposerDom();
        const requestGeneration = this.asyncGeneration;
        const requestIntentRevision = this.intentContextRevision;
        const requestBeatId = safeText(this.snapshot?.currentBeat?.id, 80);
        const requestCoreChatId = this.#getActiveCoreChatId();
        const modelMessage = safeText(
            replaceAeroLivePlayerNameForModel(message, this.playerName),
            maxChars
        );
        const modelText = (value, maxLength = 240) => safeText(
            replaceAeroLivePlayerNameForModel(value, this.playerName),
            maxLength
        );
        const requestContext = {
            message: modelMessage,
            topic: modelText(this.snapshot?.topic?.title || this.snapshot?.topic?.id || '', 80),
            heroText: modelText(this.snapshot?.currentBeat?.heroText || '', 240),
            mood: modelText(this.snapshot?.currentBeat?.mood || '', 60),
            coreChatText: modelText(this.snapshot?.activeCoreChat?.text || '', 180),
            coreChatViewerId: modelText(this.snapshot?.activeCoreChat?.author || '', 24),
            viewerIds: this.#getViewerIds()
        };

        try {
            const classification = await this.aiService.classifyPlayerMessage(requestContext);
            const currentBeatId = safeText(this.snapshot?.currentBeat?.id, 80);
            const currentCoreChatId = this.#getActiveCoreChatId();
            if (this.isDestroyed
                || requestGeneration !== this.asyncGeneration
                || this.mode !== MODE_LIVE
                || this.snapshot?.status !== 'live'
                || requestIntentRevision !== this.intentContextRevision
                || currentBeatId !== requestBeatId
                || currentCoreChatId !== requestCoreChatId
                || classification?.discarded === true) {
                return;
            }

            const response = this.runtime.submitPlayerMessage(modelMessage, classification.intent);
            if (Array.isArray(classification.reaction_chats)
                && classification.reaction_chats.length > 0
                && response?.accepted
                && this.runtime.getSnapshot()?.status === 'live') {
                const reactionChats = classification.reaction_chats.map((chat) => ({
                    ...chat,
                    text: this.#toPlayerNameTemplate(
                        chat?.text,
                        AERO_CONSTANTS.AI.GENERATED_CHAT_MAX_CHARS
                    )
                }));
                this.runtime.addGeneratedChats(reactionChats, classification.source || 'model-reaction');
            }
            if (response?.accepted) {
                this.#applyPlayerEcho(classification, modelMessage, requestBeatId);
            }
            this.#refreshRuntimeState();

            if (response?.accepted) {
                this.composer?.clear?.();
                this.#showToast(classification.reason || '채팅이 방송 여론에 반영되었습니다.');
            } else {
                this.#showToast(classification.reason || response?.reason || '이 채팅은 전송할 수 없습니다.');
            }
        } catch (error) {
            console.warn('[AeroLiveScene] 자유 채팅 판정 실패', error);
            this.#showToast('판정을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        } finally {
            if (!this.isDestroyed && requestGeneration === this.asyncGeneration) {
                this.inputClassificationPending = false;
                this.#refreshRuntimeState();
                this.#syncButtonStates();
                this.#syncComposerDom();
            }
        }
    }

    /**
     * 검증된 AI 직접 답변, 다음 비트 콜백과 결과용 기억을 템플릿 상태로 보관합니다.
     * @param {object} classification - 의도 계약을 통과한 모델 결과입니다.
     * @param {string} modelMessage - 실명 대신 `{playerName}`을 담은 플레이어 메시지입니다.
     * @param {string} beatId - 응답을 요청한 비트 ID입니다.
     * @private
     */
    #applyPlayerEcho(classification, modelMessage, beatId) {
        const heroReply = this.#toPlayerNameTemplate(classification?.hero_reply, 240);
        const callbackText = this.#toPlayerNameTemplate(classification?.callback_text, 180);
        const intent = safeText(classification?.intent, 24);
        const requestedExpression = safeText(classification?.hero_expression, 24);
        const expression = HERO_EXPRESSIONS.has(requestedExpression)
            ? requestedExpression
            : this.#getIntentExpression(intent);

        if (heroReply) {
            this.heroResponseText = heroReply;
            this.heroResponseSecondsRemaining = HERO_RESPONSE_SECONDS;
            this.heroResponseLabel = '채팅 답변';
            this.heroResponseExpression = expression;
            this.echoMemories = [
                ...this.echoMemories,
                {
                    playerMessage: safeText(modelMessage, 180),
                    heroReply,
                    callbackText,
                    intent,
                    expression
                }
            ].slice(-ECHO_MEMORY_LIMIT);
        }
        if (callbackText) {
            this.pendingEchoCallback = {
                originBeatId: beatId,
                text: callbackText,
                sentiment: intent === 'praise'
                    ? 'positive'
                    : (intent === 'provocation' ? 'negative' : 'neutral')
            };
        }
    }

    /** @returns {string} 의도에 대응하는 안전한 기본 표정입니다. @private */
    #getIntentExpression(intent) {
        if (intent === 'praise') return 'happy';
        if (intent === 'provocation') return 'angry';
        if (intent === 'rebuttal') return 'shocked';
        return 'idle';
    }

    /**
     * 모델 경계를 오가는 동적 문자열에서 닉네임 실값을 로컬 치환 토큰으로 고정합니다.
     * @param {*} value - 템플릿화할 문자열입니다.
     * @param {number} [maxChars=240] - 최대 코드포인트 수입니다.
     * @returns {string} 실제 닉네임이 없는 안전한 템플릿입니다.
     * @private
     */
    #toPlayerNameTemplate(value, maxChars = 240) {
        return safeText(
            replaceAeroLivePlayerNameForModel(value, this.playerName),
            maxChars
        );
    }

    /**
     * beat 시작 0.6초 뒤부터 안전 폴백과 AI 채팅을 1.25초 간격 큐로 방출합니다.
     * @param {object} event - beat-started 런타임 이벤트입니다.
     * @returns {Promise<void>} 비동기 채팅 생성 완료 Promise입니다.
     * @private
     */
    async #generateAmbientChats(event) {
        const requestGeneration = this.asyncGeneration;
        const beatId = event.beatId;
        const fallbackChats = Array.isArray(event.fallbackChats) ? event.fallbackChats : [];
        const modelText = (value, maxLength = 240) => safeText(
            replaceAeroLivePlayerNameForModel(value, this.playerName),
            maxLength
        );
        const modelFallbackChats = fallbackChats.map((chat) => ({
            viewerId: modelText(chat?.viewerId || chat?.viewer_id, 24),
            sentiment: safeText(chat?.sentiment, 24),
            text: modelText(chat?.text, 180)
        }));
        const context = {
            topic: modelText(event.topic?.title || event.topic?.id || '', 80),
            heroText: modelText(event.heroText || '', 240),
            mood: modelText(event.mood || '', 60),
            opinion: this.snapshot?.metrics?.opinion,
            fallbackChats: modelFallbackChats,
            viewerIds: this.#getViewerIds(fallbackChats)
        };

        const reservedViewerIds = new Set(context.viewerIds);
        const initialAhaChats = this.#createInitialAhaBurst(event, reservedViewerIds);
        const fallbackQueue = fallbackChats.map((chat) => ({ ...chat, source: 'fallback' }));
        const echoCallback = this.#takePendingEchoCallback(event, reservedViewerIds);
        if (echoCallback) {
            const callbackIndex = Math.min(2, fallbackQueue.length);
            fallbackQueue.splice(callbackIndex, 0, echoCallback);
        }
        this.ambientChatBeatId = beatId;
        this.ambientChatQueue = [
            ...initialAhaChats,
            ...fallbackQueue
        ];
        this.ambientChatSecondsRemaining = AMBIENT_CHAT_START_DELAY_SECONDS;
        this.ambientBridgeSequence = 0;
        this.ambientReservedViewerIds = reservedViewerIds;

        try {
            const generated = await this.aiService.generateChatBatch(context);
            if (this.isDestroyed
                || requestGeneration !== this.asyncGeneration
                || this.snapshot?.status !== 'live'
                || this.snapshot?.currentBeat?.id !== beatId) {
                return;
            }

            const modelChats = Array.isArray(generated?.chats) ? generated.chats : [];
            if (modelChats.length > 0) {
                this.ambientChatQueue.push(...modelChats.slice(0, 24).map((chat) => ({
                    ...chat,
                    text: this.#toPlayerNameTemplate(
                        chat?.text,
                        AERO_CONSTANTS.AI.GENERATED_CHAT_MAX_CHARS
                    ),
                    source: generated.source || 'model'
                })));
            }
        } catch (error) {
            if (this.isDestroyed || requestGeneration !== this.asyncGeneration) {
                return;
            }
            console.warn('[AeroLiveScene] 일반 채팅 폴백', error);
        }
    }

    /**
     * 이전 비트의 최신 플레이어 채팅을 다음 비트의 제품 시청자 한 명이 한 번만 회상하게 합니다.
     * @param {object} event - 새 beat-started 이벤트입니다.
     * @param {Set<string>} reservedViewerIds - 현재 모델 슬롯에 예약된 시청자 ID입니다.
     * @returns {object|null} 다음 비트 큐에 삽입할 콜백 채팅입니다.
     * @private
     */
    #takePendingEchoCallback(event, reservedViewerIds) {
        const pending = this.pendingEchoCallback;
        const nextBeatId = safeText(event?.beatId, 80);
        if (!pending || !nextBeatId || pending.originBeatId === nextBeatId) {
            return null;
        }

        const recentAuthors = new Set((Array.isArray(this.snapshot?.chats) ? this.snapshot.chats : [])
            .slice(-AMBIENT_RECENT_AUTHOR_WINDOW)
            .map((chat) => safeText(chat?.viewer_id || chat?.author, 24))
            .filter(Boolean));
        const bannedAuthors = new Set((Array.isArray(this.snapshot?.bannedAuthors)
            ? this.snapshot.bannedAuthors
            : [])
            .map((author) => safeText(author, 24))
            .filter(Boolean));
        const viewerPool = (Array.isArray(AERO_LIVE_VIEWER_IDS) ? AERO_LIVE_VIEWER_IDS : [])
            .map((candidate) => safeText(candidate, 24))
            .filter((candidate) => candidate
                && (!this.playerName
                    || !replaceAeroLivePlayerNameForModel(
                        candidate,
                        this.playerName
                    ).includes(AERO_LIVE_PLAYER_NAME_TOKEN))
                && !bannedAuthors.has(candidate));
        const viewerId = viewerPool.find((candidate) => !recentAuthors.has(candidate)
            && !(reservedViewerIds instanceof Set && reservedViewerIds.has(candidate)))
            || viewerPool.find((candidate) => !recentAuthors.has(candidate))
            || viewerPool.find((candidate) => !(reservedViewerIds instanceof Set
                && reservedViewerIds.has(candidate)))
            || viewerPool[0];
        if (!viewerId) {
            return null;
        }
        this.pendingEchoCallback = null;
        reservedViewerIds?.add?.(viewerId);
        return {
            viewer_id: viewerId,
            sentiment: pending.sentiment || 'neutral',
            text: safeText(pending.text, 180),
            source: 'echo-callback'
        };
    }

    /**
     * 방송 첫 비트에만 모델 입력과 무관한 `아하` 채팅을 큐 선두에 충분히 채웁니다.
     * 모델 슬롯, 최근 화면 작성자와 강퇴 작성자를 피해 서로 다른 제품 시청자 ID를 고릅니다.
     * @param {object} event - beat-started 런타임 이벤트입니다.
     * @param {Set<string>} reservedViewerIds - 모델 배치에 예약한 시청자 ID입니다.
     * @returns {object[]} 결정론적인 로컬 오프닝 채팅 목록입니다.
     * @private
     */
    #createInitialAhaBurst(event, reservedViewerIds) {
        if (Math.floor(finiteNumber(event?.beatIndex, -1)) !== 0) {
            return [];
        }

        const recentAuthors = new Set((Array.isArray(this.snapshot?.chats) ? this.snapshot.chats : [])
            .slice(-AMBIENT_RECENT_AUTHOR_WINDOW)
            .map((chat) => safeText(chat?.viewer_id || chat?.author, 24))
            .filter(Boolean));
        const bannedAuthors = new Set((Array.isArray(this.snapshot?.bannedAuthors)
            ? this.snapshot.bannedAuthors
            : [])
            .map((author) => safeText(author, 24))
            .filter(Boolean));
        const excludedAuthors = new Set([
            ...recentAuthors,
            ...bannedAuthors,
            ...(reservedViewerIds instanceof Set ? reservedViewerIds : [])
        ]);
        const viewerPool = (Array.isArray(AERO_LIVE_VIEWER_IDS) ? AERO_LIVE_VIEWER_IDS : [])
            .map((viewerId) => safeText(viewerId, 24))
            .filter((viewerId) => viewerId
                && (!this.playerName
                    || !replaceAeroLivePlayerNameForModel(
                        viewerId,
                        this.playerName
                    ).includes(AERO_LIVE_PLAYER_NAME_TOKEN)));
        const chats = [];
        for (const viewerId of viewerPool) {
            if (chats.length >= AMBIENT_INITIAL_AHA_BURST_COUNT) {
                break;
            }
            if (excludedAuthors.has(viewerId)) {
                continue;
            }
            excludedAuthors.add(viewerId);
            chats.push({
                viewer_id: viewerId,
                sentiment: 'neutral',
                text: AMBIENT_INITIAL_AHA_TEXT,
                source: 'opening-aha'
            });
        }
        return chats;
    }

    /**
     * 고정 스텝에 맞춰 현재 beat의 일반 채팅을 한 번에 하나씩 공개합니다.
     * @param {number} deltaSeconds - 고정 스텝 초입니다.
     * @private
     */
    #advanceAmbientChatQueue(deltaSeconds) {
        if (this.mode !== MODE_LIVE
            || this.snapshot?.status !== 'live'
            || !this.ambientChatBeatId
            || this.snapshot?.currentBeat?.id !== this.ambientChatBeatId) {
            return;
        }
        this.ambientChatSecondsRemaining -= Math.max(0, finiteNumber(deltaSeconds, 0));
        let emitted = false;
        while (this.ambientChatSecondsRemaining <= 0) {
            const chat = this.ambientChatQueue.shift() || this.#createAmbientBridgeChat();
            if (!chat) {
                this.ambientChatSecondsRemaining = AMBIENT_CHAT_INTERVAL_SECONDS;
                break;
            }
            this.runtime.addGeneratedChats([chat], chat?.source || 'ambient');
            this.ambientChatSecondsRemaining += AMBIENT_CHAT_INTERVAL_SECONDS;
            emitted = true;
        }
        if (emitted) {
            this.snapshot = this.runtime.getSnapshot();
        }
    }

    /**
     * AI 배치가 아직 대기 중이거나 모두 소진된 동안 안전한 일반 채팅 한 건을 만듭니다.
     * 최근 화면의 작성자와 강퇴된 작성자를 피하고 제품 소유 ID만 사용합니다.
     * @returns {object|null} 런타임에 추가할 결정론적 보충 채팅입니다.
     * @private
     */
    #createAmbientBridgeChat() {
        const viewerPool = (Array.isArray(AERO_LIVE_VIEWER_IDS) ? AERO_LIVE_VIEWER_IDS : [])
            .map((viewerId) => safeText(viewerId, 24))
            .filter((viewerId) => viewerId
                && (!this.playerName
                    || !replaceAeroLivePlayerNameForModel(
                        viewerId,
                        this.playerName
                    ).includes(AERO_LIVE_PLAYER_NAME_TOKEN)));
        if (viewerPool.length === 0 || AMBIENT_BRIDGE_TEXTS.length === 0) {
            return null;
        }

        const recentAuthors = new Set((Array.isArray(this.snapshot?.chats) ? this.snapshot.chats : [])
            .slice(-AMBIENT_RECENT_AUTHOR_WINDOW)
            .map((chat) => safeText(chat?.viewer_id || chat?.author, 24))
            .filter(Boolean));
        const recentTexts = new Set((Array.isArray(this.snapshot?.chats) ? this.snapshot.chats : [])
            .slice(-AMBIENT_RECENT_AUTHOR_WINDOW)
            .map((chat) => safeText(chat?.text, 180))
            .filter(Boolean));
        const bannedAuthors = new Set((Array.isArray(this.snapshot?.bannedAuthors)
            ? this.snapshot.bannedAuthors
            : [])
            .map((author) => safeText(author, 24))
            .filter(Boolean));
        const reservedViewerIds = this.ambientReservedViewerIds instanceof Set
            ? this.ambientReservedViewerIds
            : new Set();
        const beatIndex = Math.max(0, Math.floor(finiteNumber(this.snapshot?.currentBeat?.index, 0)));
        const sequence = this.ambientBridgeSequence;
        const poolStart = ((beatIndex * 15) + (sequence * 7)) % viewerPool.length;
        let viewerId = null;
        for (let offset = 0; offset < viewerPool.length; offset += 1) {
            const candidate = viewerPool[(poolStart + offset) % viewerPool.length];
            if (!recentAuthors.has(candidate)
                && !bannedAuthors.has(candidate)
                && !reservedViewerIds.has(candidate)) {
                viewerId = candidate;
                break;
            }
        }
        if (!viewerId) {
            return null;
        }

        this.ambientBridgeSequence += 1;
        const textStart = ((beatIndex * 5) + sequence) % AMBIENT_BRIDGE_TEXTS.length;
        let text = AMBIENT_BRIDGE_TEXTS[textStart];
        for (let offset = 0; offset < AMBIENT_BRIDGE_TEXTS.length; offset += 1) {
            const candidate = AMBIENT_BRIDGE_TEXTS[(textStart + offset) % AMBIENT_BRIDGE_TEXTS.length];
            if (!recentTexts.has(candidate)) {
                text = candidate;
                break;
            }
        }
        return {
            viewer_id: viewerId,
            sentiment: sequence % 3 === 0 ? 'positive' : 'neutral',
            text,
            source: 'bridge-fallback'
        };
    }

    /**
     * 핵심·후원 사건 경계 뒤 다음 일반 채팅까지의 전환 공백을 1초 미만으로 줄입니다.
     * 일반 채팅끼리의 기본 1.25초 cadence는 그대로 유지합니다.
     * @private
     */
    #shortenAmbientTransitionIdle() {
        if (!this.ambientChatBeatId
            || this.snapshot?.currentBeat?.id !== this.ambientChatBeatId) {
            return;
        }
        this.ambientChatSecondsRemaining = Math.min(
            this.ambientChatSecondsRemaining,
            AMBIENT_EVENT_TRANSITION_IDLE_SECONDS
        );
    }

    /** 현재 beat에 예약된 일반 채팅을 모두 폐기합니다. @private */
    #clearAmbientChatQueue() {
        this.ambientChatQueue = [];
        this.ambientChatBeatId = null;
        this.ambientChatSecondsRemaining = 0;
        this.ambientBridgeSequence = 0;
        this.ambientReservedViewerIds = new Set();
        this.pendingEchoCallback = null;
    }

    /**
     * 런타임 이벤트 큐를 비우고 Scene의 비동기·화면 상태에 반영합니다.
     * @private
     */
    #consumeRuntimeEvents() {
        const events = this.runtime.drainEvents();
        for (const event of events) {
            this.#handleRuntimeEvent(event);
        }
    }

    /**
     * 런타임 이벤트 하나를 UI 또는 AI 작업으로 변환합니다.
     * @param {object} event - 처리할 런타임 이벤트입니다.
     * @private
     */
    #handleRuntimeEvent(event) {
        if (!event || typeof event.type !== 'string') {
            return;
        }

        if (event.type === 'beat-started') {
            this.intentContextRevision += 1;
            void this.#generateAmbientChats(event);
            return;
        }
        if (event.type === 'core-chat-started') {
            this.intentContextRevision += 1;
            this.selectedCoreChatId = null;
            this.timerMaximums.core = Math.max(
                Number.EPSILON,
                finiteNumber(
                    event.timeLimitSeconds ?? event.timeRemainingSeconds ?? event.durationSeconds,
                    AERO_LIVE_DEFAULT_TIMING.coreChatSeconds
                )
            );
            this.#shortenAmbientTransitionIdle();
            return;
        }
        if (event.type === 'donation-started') {
            this.timerMaximums.donation = Math.max(
                Number.EPSILON,
                finiteNumber(
                    event.timeLimitSeconds ?? event.timeRemainingSeconds ?? event.durationSeconds,
                    AERO_LIVE_DEFAULT_TIMING.donationSeconds
                )
            );
            this.#shortenAmbientTransitionIdle();
            return;
        }
        if (event.type === 'donation-resolved') {
            this.heroResponseText = safeText(event.heroResponse, 240);
            this.heroResponseSecondsRemaining = 4.5;
            this.heroResponseLabel = '후원 대응';
            this.heroResponseExpression = event.timedOut
                ? 'embarrassed'
                : (event.appropriate ? 'happy' : 'sad');
            this.#shortenAmbientTransitionIdle();
            this.#showToast(event.timedOut
                ? '후원 응답 시간이 지나 자동으로 대응했습니다.'
                : (event.appropriate ? '후원 의도에 맞는 디렉션이었습니다.' : '후원 의도와 어긋난 디렉션이었습니다.'));
            return;
        }
        if (event.type === 'core-chat-resolved') {
            this.intentContextRevision += 1;
            this.selectedCoreChatId = null;
            this.#shortenAmbientTransitionIdle();
            if (event.action === 'timeout') {
                this.#showToast('핵심 채팅 대응 시간이 지났습니다.');
            }
            return;
        }
        if (event.type === 'core-chat-cancelled') {
            this.intentContextRevision += 1;
            this.selectedCoreChatId = null;
            return;
        }
        if (event.type === 'player-message-blocked') {
            this.#showToast(event.reason || '안전 기준에 따라 전송할 수 없는 채팅입니다.');
            return;
        }
        if (event.type === 'action-rejected') {
            this.#showToast(event.reason || event.message || '지금은 해당 행동을 할 수 없습니다.');
            return;
        }
        if (event.type === 'broadcast-ended') {
            this.campaign?.completeBroadcast?.(event.summary);
            this.inputClassificationPending = false;
            this.earlyEndModalOpen = false;
            this.selectedCoreChatId = null;
            this.asyncGeneration += 1;
            this.#clearAmbientChatQueue();
            this.aiService?.abortAll?.();
            this.snapshot = this.runtime.getSnapshot();
            this.mode = MODE_RESULTS;
            this.#syncButtonStates();
            this.#syncComposerDom();
        }
    }

    /**
     * snapshot과 런타임 이벤트를 한 번에 새로 읽습니다.
     * @private
     */
    #refreshRuntimeState() {
        this.snapshot = this.runtime.getSnapshot();
        this.#consumeRuntimeEvents();
        this.snapshot = this.runtime.getSnapshot();
        this.#syncSnapshotState();
    }

    /**
     * snapshot 종료 상태와 타이머 최댓값을 Scene 표현 상태에 반영합니다.
     * @private
     */
    #syncSnapshotState() {
        if (!this.snapshot) {
            return;
        }
        this.#syncCoreSelection();
        this.#syncCoreRowButtons();
        if (this.snapshot.activeCoreChat) {
            this.timerMaximums.core = Math.max(
                this.timerMaximums.core,
                finiteNumber(this.snapshot.activeCoreChat.timeRemainingSeconds, 0)
            );
        }
        if (this.snapshot.activeDonation) {
            this.timerMaximums.donation = Math.max(
                this.timerMaximums.donation,
                finiteNumber(this.snapshot.activeDonation.timeRemainingSeconds, 0)
            );
        }
        if (this.snapshot.status === 'ended') {
            this.mode = MODE_RESULTS;
            this.earlyEndModalOpen = false;
            this.selectedCoreChatId = null;
        }
    }

    /**
     * 현재 채팅과 폴백 목록에 제품 시청자 풀을 섞어 AI 계약의 허용 ID를 만듭니다.
     * @param {Array<object>} [fallbackChats=[]] - beat의 폴백 채팅입니다.
     * @returns {string[]} 최대 12개의 고유 시청자 ID입니다.
     * @private
     */
    #getViewerIds(fallbackChats = []) {
        const contextualIds = [
            ...(Array.isArray(fallbackChats) ? fallbackChats : []),
            ...(Array.isArray(this.snapshot?.chats) ? this.snapshot.chats : [])
        ]
            .filter((chat) => chat?.source !== 'player' && chat?.masked !== true)
            .map((chat) => safeText(chat?.viewer_id || chat?.viewerId || chat?.author || chat?.nickname, 24))
            .filter(Boolean);
        const isPrivateIdentity = (viewerId) => {
            const viewerKey = viewerId.toLocaleLowerCase('ko-KR');
            return viewerKey === 'aero_mask'
                || (this.playerName && replaceAeroLivePlayerNameForModel(
                    viewerId,
                    this.playerName
                ).includes(AERO_LIVE_PLAYER_NAME_TOKEN));
        };
        const privateViewerIds = createPrivateViewerIds(this.playerName);
        const uniqueContextualIds = [...new Set(contextualIds)]
            .filter((viewerId) => !isPrivateIdentity(viewerId))
            .slice(-6);
        const viewerPool = (Array.isArray(AERO_LIVE_VIEWER_IDS) ? AERO_LIVE_VIEWER_IDS : [])
            .map((viewerId) => safeText(viewerId, 24))
            .filter((viewerId) => viewerId && !isPrivateIdentity(viewerId));
        const poolOffset = viewerPool.length > 0
            ? (Math.max(0, Math.floor(finiteNumber(this.snapshot?.currentBeat?.index, 0))) * 7) % viewerPool.length
            : 0;
        const rotatedPool = viewerPool.length > 0
            ? [...viewerPool.slice(poolOffset), ...viewerPool.slice(0, poolOffset)]
            : [];
        const uniqueIds = [...new Set([
            ...uniqueContextualIds,
            ...rotatedPool,
            ...contextualIds.filter((viewerId) => !isPrivateIdentity(viewerId)),
            ...privateViewerIds
        ])].slice(0, 12);
        return uniqueIds.length > 0 ? uniqueIds : privateViewerIds;
    }

    /**
     * 짧은 상태 안내 문구를 일정 시간 표시합니다.
     * @param {*} message - 표시할 안내 문구입니다.
     * @private
     */
    #showToast(message) {
        const text = safeText(message, 120);
        if (!text) {
            return;
        }
        this.toastText = text;
        this.toastSecondsRemaining = finiteNumber(UI.STATUS_TOAST_SECONDS, 3.2);
    }

}
