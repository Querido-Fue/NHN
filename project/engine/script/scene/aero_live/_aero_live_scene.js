import { BaseScene } from 'scene/_base_scene.js';
import { getData } from 'data/data_handler.js';
import { getUIOffsetX, getUIWW, getWH, getWW } from 'display/display_system.js';
import { getDelta } from 'engine/time_handler.js';
import { getKeyboardCodeInput, getMouseInput, isMousePressing } from 'input/input_system.js';
import { UIPool, releaseUIItem } from 'ui/_ui_pool.js';
import {
    AERO_LIVE_AMBIENT_CONTEXTUAL_MEMES,
    AERO_LIVE_AMBIENT_EVENT_CONTEXTS,
    AERO_LIVE_DEFAULT_TIMING,
    AERO_LIVE_TOPIC_AMBIENT_CONTEXTS,
    AERO_LIVE_VIEWER_IDS,
    getAeroLiveTopicViewerIds
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
import { AeroLiveTutorial } from './_aero_live_tutorial.mjs';

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
const AMBIENT_INITIAL_AHA_TEXTS = Object.freeze([
    '아-하 (아쿠아 하이라는 뜻)'
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

/** 헤드리스 의존성 주입 환경에서도 Scene 수명주기를 유지할 최소 튜토리얼입니다. */
function createTutorialController() {
    if (typeof AeroLiveTutorial === 'function') {
        return new AeroLiveTutorial();
    }
    return {
        start() {},
        isActive: () => false,
        canAdvance: () => false,
        advance: () => false,
        update: () => false,
        getPresentation: () => null
    };
}

function isAeroLiveSmokeRun() {
    try {
        return typeof process !== 'undefined'
            && process?.env?.AERO_LIVE_NW_SMOKE === '1';
    } catch {
        return false;
    }
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
 * 우상단에 배치할 macOS형 창 컨트롤 좌표를 만듭니다.
 * @param {{x:number,y:number,w:number,h:number}} frame - 배경 에셋의 창 프레임입니다.
 * @param {number} contentTop - 제목 표시줄 바로 아래 콘텐츠의 y 좌표입니다.
 * @param {number} viewportHeight - 현재 논리 화면 높이입니다.
 * @returns {{buttons:Array<object>}} 빨강·노랑·초록 세 버튼입니다.
 */
function createMacWindowControls(frame, contentTop, viewportHeight) {
    const titleHeight = Math.max(1, finiteNumber(contentTop, frame.y) - frame.y);
    const radius = Math.max(
        5,
        Math.min(viewportHeight * 0.021, titleHeight * 0.32)
    );
    const gap = radius * 0.45;
    const step = radius * 2 + gap;
    const rightInset = Math.max(radius * 0.8, frame.w * 0.009);
    const greenX = frame.x + frame.w - rightInset - radius;
    const centerY = frame.y + titleHeight * 0.53;
    const controls = [
        { id: 'close', color: 'red', x: greenX - step * 2, y: centerY, radius },
        { id: 'minimize', color: 'yellow', x: greenX - step, y: centerY, radius },
        { id: 'maximize', color: 'green', x: greenX, y: centerY, radius }
    ].map((control) => ({
        ...control,
        hitRect: {
            x: control.x - radius,
            y: control.y - radius,
            w: radius * 2,
            h: radius * 2
        }
    }));
    return {
        buttons: controls
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
     * @param {{runtime?:AeroLiveRuntime,aiService?:AeroLiveAiService,runtimeOptions?:object,topicId?:string,playerName?:string,tutorial?:boolean}} [options={}] - 테스트 및 직접 진입 옵션입니다.
     */
    constructor(sceneSystem, options = {}) {
        super(sceneSystem);
        this.options = options || {};
        this.isDestroyed = false;
        this.tutorialEnabled = this.options.tutorial === true
            || (this.options.tutorial !== false
                && !this.options.runtime
                && !this.options.aiService
                && !this.options.campaign
                && !isAeroLiveSmokeRun());
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
        this.ambientChatTopicId = null;
        this.ambientBeatReferenceTexts = [];
        this.ambientChatSecondsRemaining = 0;
        this.ambientBridgeSequence = 0;
        this.ambientTransitionSequence = 0;
        this.ambientReservedViewerIds = new Set();
        this.ambientPendingModelChats = new Set();
        this.ambientModelRequestPending = false;
        this.tutorial = createTutorialController();
        this.tutorialCompleted = false;
        this.tutorialPendingBroadcastStart = false;
        this.keyLatch = new Map();
        this.buttons = [];
        this.topicButtons = [];
        this.coreButtons = [];
        this.coreRowButtons = [];
        this.donationButtons = [];
        this.tutorialAdvanceButton = null;
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
        const tutorialWasActive = this.tutorial?.isActive?.() === true;
        this.tutorial?.update?.(deltaSeconds);
        if (tutorialWasActive && this.tutorial?.isActive?.() !== true) {
            this.#finishTutorial();
        }
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
        if (this.isDestroyed
            || this.mode !== MODE_LIVE
            || this.snapshot?.status !== 'live'
            || this.tutorial?.isActive?.() === true) {
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
     * 라이브 배경과 히로인 이미지의 로드 성공 또는 실패가 확정될 때까지 기다립니다.
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
     * 실행 중 변경된 화면 설정을 AERO 전용 renderer와 overlay session에 반영합니다.
     * @param {object} [changedSettings={}] - 변경된 런타임 설정입니다.
     * @override
     */
    applyRuntimeSettings(changedSettings = {}) {
        if (this.isDestroyed) {
            return;
        }
        this.renderer?.applyRuntimeSettings?.(changedSettings);
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
        this.tutorial = null;
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
            deltaVisualSeconds: Math.max(0, finiteNumber(getDelta(), 0)),
            wallpaperPointer: this.#getWallpaperPointer(),
            timerMaximums: this.timerMaximums,
            toastText: this.toastText,
            toastSecondsRemaining: this.toastSecondsRemaining,
            heroResponseText: this.heroResponseText,
            heroResponseLabel: this.heroResponseLabel,
            heroResponseExpression: this.heroResponseExpression,
            echoMemories: this.echoMemories.map((memory) => ({ ...memory })),
            aiStatus: this.aiService?.getStatus?.() || 'AI 준비',
            campaign: this.campaign?.getSnapshot?.() || null,
            tutorial: this.tutorial?.getPresentation?.(this.layout) || null
        };
    }

    /**
     * UI 입력을 소비하지 않고 wallpaper ripple용 현재 포인터를 관찰합니다.
     * @returns {{x:number,y:number,leftDown:boolean}|null} 논리 화면 포인터입니다.
     * @private
     */
    #getWallpaperPointer() {
        try {
            return {
                x: finiteNumber(getMouseInput('x'), 0),
                y: finiteNumber(getMouseInput('y'), 0),
                leftDown: isMousePressing('left') === true
            };
        } catch {
            return null;
        }
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
        this.layoutPixelScale = Math.max(1, Math.min(
            this.UIWW / 1920,
            this.WH / 1080
        ));

        const ux = (percent) => this.UIWW * (percent / 100);
        const vy = (percent) => this.WH * (percent / 100);
        const px = (value) => value * this.layoutPixelScale;
        const safe = ux(UI.SAFE_MARGIN_UIWW);
        const gap = ux(UI.PANEL_GAP_UIWW);
        const contentX = this.UIOffsetX + safe;
        const contentW = Math.max(1, this.UIWW - (safe * 2));
        const panelPad = ux(UI.PANEL_PADDING_UIWW);
        const liveLayout = AERO_CONSTANTS.ASSET.LIVE_WINDOW_LAYOUT || {};
        const referenceWidth = Math.max(1, finiteNumber(liveLayout.REFERENCE_WIDTH, 3840));
        const referenceHeight = Math.max(1, finiteNumber(liveLayout.REFERENCE_HEIGHT, 2160));
        const mapLiveRect = (rect = {}) => ({
            x: this.UIOffsetX + this.UIWW * finiteNumber(rect.x, 0) / referenceWidth,
            y: this.WH * finiteNumber(rect.y, 0) / referenceHeight,
            w: Math.max(1, this.UIWW * finiteNumber(rect.w, referenceWidth) / referenceWidth),
            h: Math.max(1, this.WH * finiteNumber(rect.h, referenceHeight) / referenceHeight)
        });
        const mainFrame = mapLiveRect(liveLayout.MAIN_FRAME);
        const mainContent = mapLiveRect(liveLayout.MAIN_CONTENT);
        const mainStatus = mapLiveRect(liveLayout.MAIN_STATUS);
        const chatFrame = mapLiveRect(liveLayout.CHAT_FRAME);
        const chatContent = mapLiveRect(liveLayout.CHAT_CONTENT);
        const producerFrame = mapLiveRect(liveLayout.PRODUCER_FRAME);
        const producerContent = mapLiveRect(liveLayout.PRODUCER_CONTENT);
        const titleInset = Math.max(px(3), panelPad * 0.38);
        const mainWindowControls = createMacWindowControls(mainFrame, mainStatus.y, this.WH);
        const chatWindowControls = createMacWindowControls(chatFrame, chatContent.y, this.WH);
        const producerWindowControls = createMacWindowControls(producerFrame, producerContent.y, this.WH);

        this.layout = {
            safe,
            gap,
            panelPad,
            pixelScale: this.layoutPixelScale,
            backdrop: { x: this.UIOffsetX, y: 0, w: this.UIWW, h: this.WH },
            mainFrame,
            chatFrame,
            producerFrame,
            mainWindowControls,
            chatWindowControls,
            producerWindowControls,
            mainStatus,
            chatTitleBar: {
                x: chatFrame.x + titleInset,
                y: chatFrame.y,
                w: Math.max(1, chatFrame.w - titleInset * 2),
                h: Math.max(1, chatContent.y - chatFrame.y)
            },
            producerTitleBar: {
                x: producerFrame.x + titleInset,
                y: producerFrame.y,
                w: Math.max(1, producerFrame.w - titleInset * 2),
                h: Math.max(1, producerContent.y - producerFrame.y)
            },
            topBar: {
                x: mainStatus.x + panelPad,
                y: mainStatus.y + titleInset,
                w: Math.max(1, mainStatus.w - panelPad * 2),
                h: Math.max(1, mainStatus.h - titleInset * 2)
            },
            left: producerContent,
            center: mainContent,
            right: chatContent
        };

        this.layout.endButton = copyRect(mainWindowControls.buttons[0]?.hitRect);

        const producerPad = Math.max(px(4), panelPad * 0.75);
        const producerTopPad = Math.max(producerPad, panelPad * 1.15);
        const producerGap = Math.max(px(4), gap * 0.62);
        const producerInnerX = producerContent.x + producerPad;
        const producerInnerW = Math.max(1, producerContent.w - producerPad * 2);
        const metricGap = Math.max(px(3), producerGap * 0.7);
        const metricH = Math.min(
            Math.max(vy(5.8), px(34)),
            Math.max(1, producerContent.h * 0.28)
        );
        const metricW = Math.max(1, (producerInnerW - metricGap * 3) / 4);
        this.layout.metricRects = Array.from({ length: 4 }, (_, index) => ({
            x: producerInnerX + index * (metricW + metricGap),
            y: producerContent.y + producerTopPad,
            w: metricW,
            h: metricH
        }));
        this.layout.metricArea = {
            x: producerInnerX,
            y: producerContent.y + producerTopPad,
            w: producerInnerW,
            h: metricH
        };

        const producerActionsY = this.layout.metricArea.y + metricH + producerGap;
        const producerActionsH = Math.max(
            1,
            producerContent.y + producerContent.h - producerPad - producerActionsY
        );
        const donationCardW = Math.max(1, producerInnerW * 0.44);
        this.layout.donationCard = {
            x: producerInnerX,
            y: producerActionsY,
            w: donationCardW,
            h: producerActionsH
        };
        const donationGridX = producerInnerX + donationCardW + producerGap;
        const donationGridW = Math.max(1, producerInnerX + producerInnerW - donationGridX);
        const donationColumns = 3;
        const donationRows = 2;
        const donationButtonGap = Math.max(px(3), producerGap * 0.72);
        const donationActionW = Math.max(
            1,
            (donationGridW - donationButtonGap * (donationColumns - 1)) / donationColumns
        );
        const donationActionH = Math.max(
            1,
            (producerActionsH - donationButtonGap * (donationRows - 1)) / donationRows
        );
        this.layout.donationActionRects = AERO_CONSTANTS.INSTRUCTIONS.map((instruction, index) => ({
            id: instruction.id,
            x: donationGridX + (index % donationColumns) * (donationActionW + donationButtonGap),
            y: producerActionsY + Math.floor(index / donationColumns) * (donationActionH + donationButtonGap),
            w: donationActionW,
            h: donationActionH
        }));

        const heroPad = panelPad;
        const centerInner = {
            x: mainContent.x + heroPad,
            y: mainContent.y + heroPad,
            w: Math.max(1, mainContent.w - heroPad * 2),
            h: Math.max(1, mainContent.h - heroPad * 2)
        };
        const dialogueH = vy(UI.HERO_DIALOGUE_HEIGHT_WH);
        this.layout.heroDialogue = {
            x: centerInner.x,
            y: centerInner.y + centerInner.h - dialogueH,
            w: centerInner.w,
            h: dialogueH
        };
        const stageY = Math.max(
            centerInner.y,
            mainStatus.y + mainStatus.h + gap * 1.9
        );
        this.layout.heroStage = {
            x: centerInner.x,
            y: stageY,
            w: centerInner.w,
            h: Math.max(1, this.layout.heroDialogue.y - gap - stageY)
        };

        const chatPad = Math.max(px(5), panelPad * 0.75);
        const chatGap = Math.max(px(4), gap * 0.7);
        const rightInnerX = chatContent.x + chatPad;
        const rightInnerW = Math.max(1, chatContent.w - chatPad * 2);
        const composerH = Math.max(vy(UI.DOM_INPUT_HEIGHT_WH), px(34));
        const coreActionH = Math.max(vy(UI.CORE_ACTION_HEIGHT_WH), px(30));
        this.layout.composer = {
            x: rightInnerX,
            y: chatContent.y + chatContent.h - chatPad - composerH,
            w: rightInnerW,
            h: composerH
        };
        const coreActionsY = this.layout.composer.y - chatGap - coreActionH;
        const coreButtonGap = Math.max(px(3), chatGap * 0.72);
        const coreButtonCount = Math.max(1, CORE_ACTIONS.length);
        const coreButtonW = (rightInnerW - coreButtonGap * Math.max(0, coreButtonCount - 1)) / coreButtonCount;
        this.layout.coreActionRects = CORE_ACTIONS.map((action, index) => ({
            id: action.id,
            x: rightInnerX + index * (coreButtonW + coreButtonGap),
            y: coreActionsY,
            w: coreButtonW,
            h: coreActionH
        }));
        const chatHeaderH = Math.max(vy(4.5), px(28));
        this.layout.freeChatCount = {
            x: rightInnerX + rightInnerW * .54,
            y: chatContent.y + Math.max(px(2), panelPad * .18),
            w: rightInnerW * .46,
            h: Math.max(chatHeaderH, panelPad * .92)
        };
        this.layout.chatArea = {
            x: rightInnerX,
            y: chatContent.y + chatPad + chatHeaderH,
            w: rightInnerW,
            h: Math.max(1, coreActionsY - chatGap - (chatContent.y + chatPad + chatHeaderH))
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
        const px = (value) => value * Math.max(1, finiteNumber(this.layoutPixelScale, 1));
        const nicknameW = Math.min(this.UIWW * 0.54, px(680));
        const nicknameH = Math.min(this.WH * 0.48, px(360));
        const nicknameX = this.UIOffsetX + (this.UIWW - nicknameW) * 0.5;
        const nicknameY = (this.WH - nicknameH) * 0.5;
        const nicknameInputH = Math.max(px(54), this.WH * 0.082);
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

        const modalW = Math.min(this.UIWW * 0.44, px(560));
        const modalH = Math.min(this.WH * 0.36, px(280));
        const modalX = this.UIOffsetX + (this.UIWW - modalW) * 0.5;
        const modalY = (this.WH - modalH) * 0.5;
        const buttonGap = this.layout.gap;
        const buttonW = (modalW - this.layout.panelPad * 2 - buttonGap) * 0.5;
        const buttonH = Math.max(px(42), this.WH * 0.067);
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

        const resultButtonW = Math.min(px(220), this.UIWW * 0.18);
        const resultButtonH = Math.max(px(44), this.WH * 0.071);
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
        this.tutorialAdvanceButton = this.#createHitButton(this.layout.backdrop, () => this.#advanceTutorial());
        this.tutorialAdvanceButton.aeroRole = 'tutorial-advance';
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
        const tutorialActive = this.tutorial?.isActive?.() === true;
        const interactionLocked = this.earlyEndModalOpen || this.inputClassificationPending || tutorialActive;
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
        this.#setButtonState(this.tutorialAdvanceButton, tutorialActive && this.tutorial?.canAdvance?.() === true, false);
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
        this.tutorialAdvanceButton = null;
    }

    /**
     * DOM Composer를 현재 Canvas 위치와 입력 상태에 맞춥니다.
     * @private
     */
    #syncComposerDom() {
        if (this.composer && this.layout?.composer) {
            const visible = this.mode === MODE_LIVE
                && this.snapshot?.status === 'live'
                && !this.earlyEndModalOpen
                && this.tutorial?.isActive?.() !== true;
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
    }

    /**
     * 숫자키와 Escape의 단발 입력을 현재 모드 동작으로 변환합니다.
     * @private
     */
    #handleKeyboardInput() {
        if (this.tutorial?.isActive?.() === true) {
            const advanceRequested = this.#consumeKeyPress('Space');
            if (advanceRequested) {
                this.#advanceTutorial();
            }
            return;
        }
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
            this.tutorialPendingBroadcastStart = this.tutorialEnabled && !this.tutorialCompleted;
            if (this.tutorialPendingBroadcastStart) {
                this.tutorial?.start?.();
            } else {
                this.#consumeRuntimeEvents();
            }
            this.#syncSnapshotState();
            this.#syncButtonStates();
            this.#syncComposerDom();
        } catch (error) {
            if (campaignPrepared) {
                this.campaign.cancelPreparedBroadcast();
            }
            console.warn('[AeroLiveScene] 방송 시작 실패', error);
            this.#showToast('방송을 시작하지 못했습니다. 다른 주제를 선택해 주세요.');
        }
    }

    /** 사용자의 클릭·Space 입력으로 다음 튜토리얼 단계 전환을 시작합니다. @private */
    #advanceTutorial() {
        if (this.tutorial?.advance?.() !== true) {
            return;
        }
        this.#syncButtonStates();
        this.#syncComposerDom();
    }

    /** 마지막 안내가 사라진 뒤 보류해 둔 첫 비트의 런타임 이벤트를 시작합니다. @private */
    #finishTutorial() {
        if (!this.tutorialPendingBroadcastStart) {
            return;
        }
        this.tutorialPendingBroadcastStart = false;
        this.tutorialCompleted = true;
        if (this.mode === MODE_LIVE && this.snapshot?.status === 'live') {
            this.#consumeRuntimeEvents();
            this.#syncSnapshotState();
        }
        this.#syncButtonStates();
        this.#syncComposerDom();
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
        this.earlyEndModalOpen = false;
        this.selectedCoreChatId = null;
        this.toastText = '';
        this.toastSecondsRemaining = 0;
        this.heroResponseText = '';
        this.heroResponseSecondsRemaining = 0;
        this.heroResponseLabel = '';
        this.heroResponseExpression = 'idle';
        this.echoMemories = [];
        this.pendingEchoCallback = null;
        this.timerMaximums = createTimerMaximums(this.runtimeOptions);
        this.keyLatch.clear();
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
        }
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
        }
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
            } else {
                this.#showToast('이 채팅은 전송할 수 없습니다.');
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
     * 일반 채팅 맥락에 포함할 현재 핵심 채팅 또는 후원 사건을 정리합니다.
     * @returns {{id:string,kind:'core'|'donation',text:string,tone:string}|null} 현재 사건입니다.
     * @private
     */
    #getAmbientActiveEvent() {
        const donation = this.snapshot?.activeDonation;
        const donationId = safeText(donation?.id, 80);
        if (donation && donationId) {
            return {
                id: donationId,
                kind: 'donation',
                text: safeText(donation.text, 180),
                tone: safeText(donation.tone, 24) || 'neutral'
            };
        }

        const coreChat = this.snapshot?.activeCoreChat;
        const coreChatId = safeText(coreChat?.coreChatId || coreChat?.id, 80);
        if (coreChat && coreChatId) {
            return {
                id: coreChatId,
                kind: 'core',
                text: safeText(coreChat.text, 180),
                tone: safeText(coreChat.sentiment, 24) || 'neutral'
            };
        }
        return null;
    }

    /**
     * beat 시작 0.6초 뒤부터 안전 폴백과 AI 채팅을 1.25초 간격 큐로 방출합니다.
     * @param {object} event - beat-started 런타임 이벤트입니다.
     * @returns {Promise<void>} 비동기 채팅 생성 완료 Promise입니다.
     * @private
     */
    async #generateAmbientChats(event) {
        const requestGeneration = this.asyncGeneration;
        const beatId = safeText(event?.beatId, 80);
        const fallbackChats = Array.isArray(event.fallbackChats) ? event.fallbackChats : [];
        const modelText = (value, maxLength = 240) => safeText(
            replaceAeroLivePlayerNameForModel(value, this.playerName),
            maxLength
        );
        const topicId = modelText(event.topic?.id || this.snapshot?.topic?.id || '', 80);
        const topicTitle = modelText(event.topic?.title || topicId, 80);
        const topicConcept = modelText(event.topic?.concept || this.snapshot?.topic?.concept || '', 180);
        const beatIndex = Math.max(0, Math.floor(finiteNumber(
            event.beatIndex,
            finiteNumber(this.snapshot?.currentBeat?.index, 0)
        )));
        const beatCount = Math.max(1, Math.floor(finiteNumber(
            event.beatCount,
            finiteNumber(this.snapshot?.currentBeat?.total, 1)
        )));
        // fallback 작성자를 슬롯 힌트로 넘기면 계약이 첫 모델 슬롯에 다시 고정하므로,
        // 본문·감정만 맥락으로 전달하고 작성자 순서는 viewerIds가 전담합니다.
        const modelFallbackChats = fallbackChats.map((chat) => ({
            sentiment: safeText(chat?.sentiment, 24),
            text: modelText(chat?.text, 180)
        }));
        const activeEvent = this.#getAmbientActiveEvent();
        const contextEventId = activeEvent?.id || null;
        const modelActiveEvent = activeEvent
            ? {
                id: modelText(activeEvent.id, 80),
                kind: modelText(activeEvent.kind, 24),
                text: modelText(activeEvent.text, 180),
                tone: modelText(activeEvent.tone, 24)
            }
            : null;
        this.ambientChatTopicId = topicId;
        this.ambientBeatReferenceTexts = fallbackChats
            .map((chat) => safeText(chat?.text, 180))
            .filter(Boolean);
        const initialAhaChats = this.#createInitialAhaBurst(event, fallbackChats);
        const context = {
            topic: topicTitle,
            topicId,
            topicTitle,
            topicConcept,
            beatId,
            beatIndex,
            beatCount,
            heroText: modelText(event.heroText || '', 240),
            mood: modelText(event.mood || '', 60),
            activeEvent: modelActiveEvent,
            referenceChats: modelFallbackChats,
            opinion: this.snapshot?.metrics?.opinion,
            fallbackChats: modelFallbackChats,
            viewerIds: this.#getViewerIds(fallbackChats, initialAhaChats)
        };

        const reservedViewerIds = new Set(context.viewerIds);
        const pendingModelChats = new Set();
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
        this.ambientTransitionSequence = 0;
        this.ambientReservedViewerIds = reservedViewerIds;
        this.ambientPendingModelChats = pendingModelChats;
        this.ambientModelRequestPending = true;

        try {
            const generated = await this.aiService.generateChatBatch(context);
            if (this.isDestroyed
                || requestGeneration !== this.asyncGeneration
                || this.snapshot?.status !== 'live'
                || this.snapshot?.currentBeat?.id !== beatId
                || (contextEventId
                    && this.#getAmbientActiveEvent()?.id !== contextEventId)) {
                return;
            }

            const modelChats = Array.isArray(generated?.chats) ? generated.chats : [];
            if (modelChats.length > 0) {
                const queuedModelChats = modelChats.slice(0, 24).map((chat) => ({
                    ...chat,
                    text: this.#toPlayerNameTemplate(
                        chat?.text,
                        AERO_CONSTANTS.AI.GENERATED_CHAT_MAX_CHARS
                    ),
                    source: generated.source || 'model',
                    contextEventId
                }));
                for (const chat of queuedModelChats) {
                    pendingModelChats.add(chat);
                }
                this.ambientChatQueue.push(...queuedModelChats);
            }
        } catch (error) {
            if (this.isDestroyed || requestGeneration !== this.asyncGeneration) {
                return;
            }
            console.warn('[AeroLiveScene] 일반 채팅 폴백', error);
        } finally {
            if (this.ambientPendingModelChats === pendingModelChats) {
                this.ambientModelRequestPending = false;
            }
            this.#releaseAmbientViewerReservations(
                reservedViewerIds,
                pendingModelChats
            );
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
     * 알려진 주제에서는 해당 주제의 15개 ID만 반환합니다.
     * 사용자 정의 주제에만 전체 제품 ID를 안전 폴백으로 사용합니다.
     * @param {string} [topicId] - 우선할 주제 ID입니다.
     * @returns {string[]} 플레이어 닉네임과 겹치지 않는 결정론적 ID 풀입니다.
     * @private
     */
    #getAmbientViewerPool(topicId = this.ambientChatTopicId || this.snapshot?.topic?.id) {
        const topicViewerIds = getAeroLiveTopicViewerIds(safeText(topicId, 80))
            .map((viewerId) => safeText(viewerId, 24))
            .filter(Boolean);
        const viewerIds = topicViewerIds.length > 0
            ? topicViewerIds
            : (Array.isArray(AERO_LIVE_VIEWER_IDS) ? AERO_LIVE_VIEWER_IDS : [])
                .map((viewerId) => safeText(viewerId, 24))
                .filter(Boolean);
        return viewerIds.filter((viewerId) => (
            !this.playerName
            || !replaceAeroLivePlayerNameForModel(
                viewerId,
                this.playerName
            ).includes(AERO_LIVE_PLAYER_NAME_TOKEN)
        ));
    }

    /**
     * 히로인 답변, 후원, 핵심 채팅, 현재 비트 순서로 bridge 맥락을 고릅니다.
     * @returns {'heroResponse'|'donation'|'core'|'beat'} 현재 최우선 맥락입니다.
     * @private
     */
    #resolveAmbientContextKind() {
        if (this.heroResponseText && this.heroResponseSecondsRemaining > 0) {
            return 'heroResponse';
        }
        if (this.snapshot?.activeDonation) {
            return 'donation';
        }
        if (this.snapshot?.activeCoreChat) {
            return 'core';
        }
        return 'beat';
    }

    /**
     * 로컬 맥락 종류에 맞는 정적 문구 풀을 반환합니다.
     * @param {'heroResponse'|'donation'|'core'|'coreResolved'|'beat'} kind - 맥락 종류입니다.
     * @returns {string[]} 최근 중복 검사에 사용할 정리된 문구입니다.
     * @private
     */
    #getAmbientContextTexts(kind) {
        if (kind !== 'beat') {
            return (Array.isArray(AERO_LIVE_AMBIENT_EVENT_CONTEXTS?.[kind])
                ? AERO_LIVE_AMBIENT_EVENT_CONTEXTS[kind]
                : [])
                .map((text) => safeText(text, 180))
                .filter(Boolean);
        }
        const topicId = safeText(
            this.ambientChatTopicId || this.snapshot?.topic?.id,
            80
        );
        const topicTexts = Array.isArray(AERO_LIVE_TOPIC_AMBIENT_CONTEXTS?.[topicId])
            ? AERO_LIVE_TOPIC_AMBIENT_CONTEXTS[topicId]
            : [];
        return [...new Set([
            ...this.ambientBeatReferenceTexts,
            ...topicTexts
        ].map((text) => safeText(text, 180)).filter(Boolean))];
    }

    /**
     * 최근 9행과 강퇴 작성자는 반드시 피하고 현재 주제 ID 안에서만 선택합니다.
     * 모델 예약 ID는 우선 피하되, 남은 후보가 없으면 방송을 멈추거나 타 주제로
     * 넘어가지 않고 같은 주제의 안전한 예약 ID를 사용합니다.
     * @param {number} sequence - 현재 로컬 bridge 순번입니다.
     * @returns {string|null} 사용할 시청자 ID입니다.
     * @private
     */
    #selectAmbientViewerId(sequence) {
        const viewerPool = this.#getAmbientViewerPool();
        if (viewerPool.length === 0) {
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
        const reservedViewerIds = this.ambientReservedViewerIds instanceof Set
            ? this.ambientReservedViewerIds
            : new Set();
        const rotate = (pool, offset) => pool.length > 0
            ? [...pool.slice(offset % pool.length), ...pool.slice(0, offset % pool.length)]
            : [];
        const candidates = rotate(viewerPool, sequence * 7);
        return candidates.find((candidate) => !recentAuthors.has(candidate)
            && !bannedAuthors.has(candidate)
            && !reservedViewerIds.has(candidate))
            || candidates.find((candidate) => !recentAuthors.has(candidate)
                && !bannedAuthors.has(candidate))
            || null;
    }

    /**
     * 지정한 맥락의 로컬 채팅 한 건을 만듭니다. 매 5번째 항목은 현재를 직접
     * 가리키는 contextual meme을 사용하고 나머지는 정적 상황 문구를 사용합니다.
     * @param {{kind?:string,eventId?:string|null,source?:string,advanceBridgeSequence?:boolean}} [options={}] - 생성 옵션입니다.
     * @returns {object|null} 다음 cadence 슬롯에 넣을 채팅입니다.
     * @private
     */
    #createAmbientContextChat(options = {}) {
        const kind = safeText(options.kind, 24) || this.#resolveAmbientContextKind();
        const isBridge = options.advanceBridgeSequence !== false;
        const sequence = isBridge
            ? this.ambientBridgeSequence
            : this.ambientTransitionSequence;
        const viewerId = this.#selectAmbientViewerId(sequence);
        if (!viewerId) {
            return null;
        }

        const contextTexts = this.#getAmbientContextTexts(kind);
        const beatContextTexts = this.#getAmbientContextTexts('beat');
        const resolvedContextTexts = contextTexts.length > 0
            ? contextTexts
            : beatContextTexts;
        const memeKey = Object.prototype.hasOwnProperty.call(
            AERO_LIVE_AMBIENT_CONTEXTUAL_MEMES,
            kind
        )
            ? kind
            : 'beat';
        const contextualMemes = (Array.isArray(AERO_LIVE_AMBIENT_CONTEXTUAL_MEMES[memeKey])
            ? AERO_LIVE_AMBIENT_CONTEXTUAL_MEMES[memeKey]
            : [])
            .map((text) => safeText(text, 180))
            .filter(Boolean);
        const useContextualMeme = isBridge && (sequence + 1) % 5 === 0;
        const preferredTexts = useContextualMeme ? contextualMemes : resolvedContextTexts;
        const candidateTexts = preferredTexts.length > 0
            ? preferredTexts
            : (useContextualMeme ? resolvedContextTexts : contextualMemes);
        if (candidateTexts.length === 0) {
            return null;
        }

        const recentTexts = new Set((Array.isArray(this.snapshot?.chats) ? this.snapshot.chats : [])
            .slice(-AMBIENT_RECENT_AUTHOR_WINDOW)
            .map((chat) => safeText(chat?.text, 180))
            .filter(Boolean));
        const beatIndex = Math.max(0, Math.floor(finiteNumber(
            this.snapshot?.currentBeat?.index,
            0
        )));
        const textStart = ((beatIndex * 3) + sequence) % candidateTexts.length;
        let text = candidateTexts[textStart];
        for (let offset = 0; offset < candidateTexts.length; offset += 1) {
            const candidate = candidateTexts[(textStart + offset) % candidateTexts.length];
            if (!recentTexts.has(candidate)) {
                text = candidate;
                break;
            }
        }

        if (isBridge) {
            this.ambientBridgeSequence += 1;
        } else {
            this.ambientTransitionSequence += 1;
        }
        return {
            viewer_id: viewerId,
            sentiment: 'neutral',
            text,
            source: safeText(options.source, 24) || 'bridge-fallback',
            contextEventId: safeText(options.eventId, 80) || null
        };
    }

    /**
     * 사건 전환 반응을 즉시 방출하지 않고 현재 큐의 다음 cadence 슬롯 앞으로 넣습니다.
     * @param {'core'|'donation'|'heroResponse'|'coreResolved'} kind - 전환 종류입니다.
     * @param {string|null} [eventId=null] - 활성 사건 ID입니다.
     * @private
     */
    #queueAmbientTransitionChat(kind, eventId = null) {
        if (!this.ambientChatBeatId
            || this.snapshot?.currentBeat?.id !== this.ambientChatBeatId) {
            return;
        }
        const chat = this.#createAmbientContextChat({
            kind,
            eventId,
            source: 'event-context',
            advanceBridgeSequence: false
        });
        if (chat) {
            this.ambientChatQueue.unshift(chat);
        }
    }

    /**
     * 해결되거나 취소된 사건을 전제로 생성된 대기 채팅을 제거합니다.
     * @param {string} eventId - 종료된 핵심 채팅 또는 후원 ID입니다.
     * @private
     */
    #discardAmbientEventChats(eventId) {
        const safeEventId = safeText(eventId, 80);
        if (!safeEventId) {
            return;
        }
        this.ambientChatQueue = this.ambientChatQueue.filter((chat) => {
            const keep = safeText(chat?.contextEventId, 80) !== safeEventId;
            if (!keep) {
                this.ambientPendingModelChats.delete(chat);
            }
            return keep;
        });
        this.#releaseAmbientViewerReservations();
    }

    /**
     * 현재 모델 배치의 마지막 대기 항목이 사라졌을 때만 시청자 예약을 풉니다.
     * 이전 비트의 늦은 Promise가 새 비트 예약을 지우지 못하도록 Set identity도 확인합니다.
     * @param {Set<string>} [reservedViewerIds=this.ambientReservedViewerIds] - 요청별 예약 ID입니다.
     * @param {Set<object>} [pendingModelChats=this.ambientPendingModelChats] - 큐에 남은 모델 객체입니다.
     * @private
     */
    #releaseAmbientViewerReservations(
        reservedViewerIds = this.ambientReservedViewerIds,
        pendingModelChats = this.ambientPendingModelChats
    ) {
        if (this.ambientReservedViewerIds !== reservedViewerIds
            || this.ambientPendingModelChats !== pendingModelChats
            || this.ambientModelRequestPending
            || pendingModelChats.size > 0) {
            return;
        }
        reservedViewerIds.clear();
    }

    /**
     * 방송 첫 비트에만 모델 입력과 무관한 `아하` 인사 한 건을 큐 선두에 채웁니다.
     * 최근 화면·강퇴·현재 fallback 작성자를 피해 현재 주제의 제품 ID를 고릅니다.
     * 이 작성자는 뒤이어 계산하는 모델 슬롯에서도 제외합니다.
     * @param {object} event - beat-started 런타임 이벤트입니다.
     * @param {Array<object>} fallbackChats - 바로 뒤에 방출할 현재 비트 fallback입니다.
     * @returns {object[]} 결정론적인 로컬 오프닝 채팅 목록입니다.
     * @private
     */
    #createInitialAhaBurst(event, fallbackChats) {
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
        const fallbackAuthors = new Set((Array.isArray(fallbackChats) ? fallbackChats : [])
            .map((chat) => safeText(chat?.viewer_id || chat?.viewerId || chat?.author, 24))
            .filter(Boolean));
        const excludedAuthors = new Set([
            ...recentAuthors,
            ...bannedAuthors,
            ...fallbackAuthors
        ]);
        const viewerPool = this.#getAmbientViewerPool(event?.topic?.id);
        const chats = [];
        for (const viewerId of viewerPool) {
            if (chats.length >= AMBIENT_INITIAL_AHA_TEXTS.length) {
                break;
            }
            if (excludedAuthors.has(viewerId)) {
                continue;
            }
            excludedAuthors.add(viewerId);
            chats.push({
                viewer_id: viewerId,
                sentiment: 'neutral',
                text: AMBIENT_INITIAL_AHA_TEXTS[chats.length],
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
            const queuedChat = this.ambientChatQueue.shift();
            if (queuedChat && this.ambientPendingModelChats.delete(queuedChat)) {
                this.#releaseAmbientViewerReservations();
            }
            const chat = queuedChat || this.#createAmbientBridgeChat();
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
     * 현재 답변·사건·비트 맥락을 우선하며 범용 무관 문구는 사용하지 않습니다.
     * @returns {object|null} 런타임에 추가할 결정론적 보충 채팅입니다.
     * @private
     */
    #createAmbientBridgeChat() {
        return this.#createAmbientContextChat({
            kind: this.#resolveAmbientContextKind(),
            source: 'bridge-fallback'
        });
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
        this.ambientChatTopicId = null;
        this.ambientBeatReferenceTexts = [];
        this.ambientChatSecondsRemaining = 0;
        this.ambientBridgeSequence = 0;
        this.ambientTransitionSequence = 0;
        this.ambientReservedViewerIds = new Set();
        this.ambientPendingModelChats = new Set();
        this.ambientModelRequestPending = false;
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
            const coreEventId = safeText(
                event.coreChat?.coreChatId || event.coreChat?.id,
                80
            );
            this.timerMaximums.core = Math.max(
                Number.EPSILON,
                finiteNumber(
                    event.timeLimitSeconds ?? event.timeRemainingSeconds ?? event.durationSeconds,
                    AERO_LIVE_DEFAULT_TIMING.coreChatSeconds
                )
            );
            this.#shortenAmbientTransitionIdle();
            this.#queueAmbientTransitionChat('core', coreEventId);
            return;
        }
        if (event.type === 'donation-started') {
            const donationEventId = safeText(event.donation?.id, 80);
            this.timerMaximums.donation = Math.max(
                Number.EPSILON,
                finiteNumber(
                    event.timeLimitSeconds ?? event.timeRemainingSeconds ?? event.durationSeconds,
                    AERO_LIVE_DEFAULT_TIMING.donationSeconds
                )
            );
            this.#shortenAmbientTransitionIdle();
            this.#queueAmbientTransitionChat('donation', donationEventId);
            return;
        }
        if (event.type === 'donation-resolved') {
            const donationEventId = safeText(event.donation?.id, 80);
            this.#discardAmbientEventChats(donationEventId);
            this.heroResponseText = safeText(event.heroResponse, 240);
            this.heroResponseSecondsRemaining = 4.5;
            this.heroResponseLabel = '후원 대응';
            this.heroResponseExpression = event.timedOut
                ? 'embarrassed'
                : (event.appropriate ? 'happy' : 'sad');
            this.#shortenAmbientTransitionIdle();
            this.#queueAmbientTransitionChat('heroResponse');
            return;
        }
        if (event.type === 'core-chat-resolved') {
            this.intentContextRevision += 1;
            this.selectedCoreChatId = null;
            const coreEventId = safeText(
                event.coreChat?.coreChatId || event.coreChat?.id,
                80
            );
            this.#discardAmbientEventChats(coreEventId);
            this.#shortenAmbientTransitionIdle();
            this.#queueAmbientTransitionChat('coreResolved');
            return;
        }
        if (event.type === 'core-chat-cancelled') {
            this.intentContextRevision += 1;
            this.selectedCoreChatId = null;
            this.#discardAmbientEventChats(
                event.coreChat?.coreChatId || event.coreChat?.id
            );
            return;
        }
        if (event.type === 'donation-cancelled') {
            this.#discardAmbientEventChats(event.donation?.id);
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
            this.campaign?.reset?.({
                initialMetrics: this.runtimeOptions.initialMetrics
            });
            this.inputClassificationPending = false;
            this.earlyEndModalOpen = false;
            this.selectedCoreChatId = null;
            this.asyncGeneration += 1;
            this.#clearAmbientChatQueue();
            this.aiService?.abortAll?.();
            this.snapshot = this.runtime.getSnapshot();
            this.mode = MODE_RESULTS;
            this.toastText = '';
            this.toastSecondsRemaining = 0;
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
     * 실제 방출 순서(최근 행→오프닝→fallback)를 시뮬레이션해 최근 9행에
     * 재등장하지 않는 현재 주제 모델 슬롯을 순서대로 만듭니다.
     * @param {Array<object>} [fallbackChats=[]] - beat의 폴백 채팅입니다.
     * @param {Array<object>} [prefixChats=[]] - fallback 앞에 나갈 로컬 채팅입니다.
     * @returns {string[]} 최대 12개의 고유 시청자 ID입니다.
     * @private
     */
    #getViewerIds(fallbackChats = [], prefixChats = []) {
        const isPrivateIdentity = (viewerId) => {
            const viewerKey = viewerId.toLocaleLowerCase('ko-KR');
            return viewerKey === 'aero_mask'
                || (this.playerName && replaceAeroLivePlayerNameForModel(
                    viewerId,
                    this.playerName
                ).includes(AERO_LIVE_PLAYER_NAME_TOKEN));
        };
        const privateViewerIds = createPrivateViewerIds(this.playerName);
        const topicViewerIds = getAeroLiveTopicViewerIds(
            safeText(this.snapshot?.topic?.id || this.ambientChatTopicId, 80)
        )
            .map((viewerId) => safeText(viewerId, 24))
            .filter((viewerId) => viewerId && !isPrivateIdentity(viewerId));
        const fallbackViewerIds = topicViewerIds.length > 0
            ? topicViewerIds
            : (Array.isArray(AERO_LIVE_VIEWER_IDS) ? AERO_LIVE_VIEWER_IDS : [])
                .map((viewerId) => safeText(viewerId, 24))
                .filter((viewerId) => viewerId && !isPrivateIdentity(viewerId));
        const bannedAuthors = new Set((Array.isArray(this.snapshot?.bannedAuthors)
            ? this.snapshot.bannedAuthors
            : [])
            .map((author) => safeText(author, 24))
            .filter(Boolean));
        const prefixViewerIds = (Array.isArray(prefixChats) ? prefixChats : [])
            .map((chat) => safeText(chat?.viewer_id || chat?.viewerId || chat?.author, 24))
            .filter(Boolean);
        const excludedModelIds = new Set(prefixViewerIds);
        const beatIndex = Math.max(
            0,
            Math.floor(finiteNumber(this.snapshot?.currentBeat?.index, 0))
        );
        const topicOffset = fallbackViewerIds.length > 0
            ? (beatIndex * 3) % fallbackViewerIds.length
            : 0;
        const rotatedViewerIds = fallbackViewerIds.length > 0
            ? [
                ...fallbackViewerIds.slice(topicOffset),
                ...fallbackViewerIds.slice(0, topicOffset)
            ]
            : [];
        const candidates = rotatedViewerIds.filter((viewerId) => (
            !bannedAuthors.has(viewerId) && !excludedModelIds.has(viewerId)
        ));
        const recentWindow = (Array.isArray(this.snapshot?.chats) ? this.snapshot.chats : [])
            .slice(-AMBIENT_RECENT_AUTHOR_WINDOW)
            .map((chat) => safeText(chat?.viewer_id || chat?.author, 24))
            .filter(Boolean);
        for (const chat of [
            ...(Array.isArray(prefixChats) ? prefixChats : []),
            ...(Array.isArray(fallbackChats) ? fallbackChats : [])
        ]) {
            const viewerId = safeText(chat?.viewer_id || chat?.viewerId || chat?.author, 24);
            if (!viewerId) continue;
            recentWindow.push(viewerId);
            if (recentWindow.length > AMBIENT_RECENT_AUTHOR_WINDOW) {
                recentWindow.shift();
            }
        }

        const scheduledViewerIds = [];
        while (scheduledViewerIds.length < 12) {
            const recentAuthors = new Set(recentWindow);
            const nextViewerId = candidates.find((viewerId) => (
                !scheduledViewerIds.includes(viewerId) && !recentAuthors.has(viewerId)
            ));
            if (!nextViewerId) {
                break;
            }
            scheduledViewerIds.push(nextViewerId);
            recentWindow.push(nextViewerId);
            if (recentWindow.length > AMBIENT_RECENT_AUTHOR_WINDOW) {
                recentWindow.shift();
            }
        }
        return scheduledViewerIds.length > 0 ? scheduledViewerIds : privateViewerIds;
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
