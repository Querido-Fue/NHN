import { BaseScene } from 'scene/_base_scene.js';
import { getData } from 'data/data_handler.js';
import { getUIOffsetX, getUIWW, getWH, getWW } from 'display/display_system.js';
import { getDelta } from 'engine/time_handler.js';
import { getKeyboardCodeInput } from 'input/input_system.js';
import { UIPool, releaseUIItem } from 'ui/_ui_pool.js';
import { AERO_LIVE_DEFAULT_TIMING } from './_aero_live_content.mjs';
import { AeroLiveCampaign } from './_aero_live_campaign.mjs';
import { AeroLiveRuntime } from './_aero_live_runtime.mjs';
import { AeroLiveAiService } from './_aero_live_ai_service.js';
import { AeroLiveDomComposer } from './_aero_live_dom_composer.js';
import { AeroLiveRenderer } from './_aero_live_renderer.js';

const AERO_CONSTANTS = getData('AERO_LIVE_SCENE_CONSTANTS');
const UI = AERO_CONSTANTS.UI;
const COLORS = AERO_CONSTANTS.COLORS;
const TRANSPARENT = 'rgba(255,255,255,0)';
const MODE_TOPIC_SELECT = 'topicSelect';
const MODE_LIVE = 'live';
const MODE_RESULTS = 'results';
const AMBIENT_CHAT_START_DELAY_SECONDS = 2;
const AMBIENT_CHAT_INTERVAL_SECONDS = 1;
const CORE_ACTIONS = Object.freeze([
    Object.freeze({ id: 'kick', label: '강퇴', color: COLORS.NEGATIVE }),
    Object.freeze({ id: 'ignore', label: '그대로 두기', color: COLORS.NEUTRAL })
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
 * AERO LIVE의 주제 선택, 방송, 결과 화면을 하나의 수명주기에서 관리합니다.
 */
export class AeroLiveScene extends BaseScene {
    /**
     * @param {object} sceneSystem - 엔진 씬 시스템입니다.
     * @param {{runtime?:AeroLiveRuntime,aiService?:AeroLiveAiService,runtimeOptions?:object,topicId?:string}} [options={}] - 테스트 및 직접 진입 옵션입니다.
     */
    constructor(sceneSystem, options = {}) {
        super(sceneSystem);
        this.options = options || {};
        this.isDestroyed = false;
        this.mode = MODE_TOPIC_SELECT;
        this.earlyEndModalOpen = false;
        this.inputClassificationPending = false;
        this.asyncGeneration = 0;
        this.elapsedVisualSeconds = 0;
        this.toastText = '';
        this.toastSecondsRemaining = 0;
        this.heroResponseText = '';
        this.heroResponseSecondsRemaining = 0;
        this.ambientChatQueue = [];
        this.ambientChatBeatId = null;
        this.ambientChatSecondsRemaining = 0;
        this.keyLatch = new Map();
        this.buttons = [];
        this.topicButtons = [];
        this.coreButtons = [];
        this.donationButtons = [];
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
        this.#syncComposerDom();
        if (typeof this.options.topicId === 'string' && this.options.topicId) {
            this.#startBroadcast(this.options.topicId);
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
        }

        this.#handleKeyboardInput();
        this.#syncSnapshotState();
        this.#syncButtonStates();
        for (const button of this.buttons) {
            if (button.visible) {
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
        this.renderer?.destroy?.();
        this.composer = null;
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
            layout: this.layout,
            snapshot: this.snapshot,
            topicSummaries: this.topicSummaries,
            topicButtons: this.topicButtons,
            coreButtons: this.coreButtons,
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
        const pinnedCoreH = Math.max(vy(11.5), 72);
        this.layout.coreCard = {
            x: rightInnerX,
            y: coreActionsY - gap - pinnedCoreH,
            w: rightInnerW,
            h: pinnedCoreH
        };
        this.layout.chatArea = {
            x: rightInnerX,
            y: bodyY + panelPad + vy(4.6),
            w: rightInnerW,
            h: Math.max(1, this.layout.coreCard.y - gap - (bodyY + panelPad + vy(4.6)))
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
        const live = this.mode === MODE_LIVE && this.snapshot?.status === 'live';
        const interactionLocked = this.earlyEndModalOpen || this.inputClassificationPending;
        const coreActive = live && !!this.snapshot?.activeCoreChat;
        const donationActive = live && !!this.snapshot?.activeDonation;

        for (const button of this.topicButtons) {
            this.#setButtonState(button, this.mode === MODE_TOPIC_SELECT, false);
        }
        for (const button of this.coreButtons) {
            const isKickUnavailable = button.aeroData?.id === 'kick'
                && finiteNumber(this.snapshot?.resources?.kicksRemaining, 0) <= 0;
            this.#setButtonState(button, coreActive, interactionLocked || isKickUnavailable);
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
        this.donationButtons = [];
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
        if (!this.composer || !this.layout?.composer) {
            return;
        }
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
            uiWidth: this.UIWW,
            viewportHeight: this.WH
        });
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
        if (this.isDestroyed || !topicId || this.snapshot?.status === 'live') {
            return;
        }

        let campaignPrepared = false;
        try {
            const initialMetrics = this.campaign.prepareBroadcast(topicId);
            campaignPrepared = true;
            if (this.injectedRuntimePending && this.snapshot?.status === 'idle') {
                this.injectedRuntimePending = false;
            } else {
                this.#replaceRuntime(initialMetrics);
            }
            this.snapshot = this.runtime.startBroadcast(topicId);
            this.mode = MODE_LIVE;
            this.earlyEndModalOpen = false;
            this.timerMaximums = createTimerMaximums(this.runtimeOptions);
            this.heroResponseText = '';
            this.heroResponseSecondsRemaining = 0;
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
        this.aiService?.abortAll?.();
        this.inputClassificationPending = false;
        this.heroResponseText = '';
        this.heroResponseSecondsRemaining = 0;
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

    /**
     * 현재 핵심 채팅에 강퇴 또는 그대로 두기 행동을 적용합니다.
     * @param {'kick'|'ignore'} action - 핵심 채팅 대응 행동입니다.
     * @private
     */
    #resolveCoreChat(action) {
        if (this.mode !== MODE_LIVE || this.earlyEndModalOpen || this.inputClassificationPending) {
            return;
        }
        const response = this.runtime.resolveCoreChat(action);
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
        const requestContext = {
            message,
            topic: this.snapshot?.topic?.title || this.snapshot?.topic?.id || '',
            heroText: this.snapshot?.currentBeat?.heroText || '',
            mood: this.snapshot?.currentBeat?.mood || '',
            coreChatText: this.snapshot?.activeCoreChat?.text || '',
            coreChatViewerId: this.snapshot?.activeCoreChat?.author || '',
            viewerIds: this.#getViewerIds()
        };

        try {
            const classification = await this.aiService.classifyPlayerMessage(requestContext);
            if (this.isDestroyed || requestGeneration !== this.asyncGeneration) {
                return;
            }

            const response = this.runtime.submitPlayerMessage(message, classification.intent);
            if (Array.isArray(classification.reaction_chats)
                && classification.reaction_chats.length > 0
                && response?.accepted
                && this.runtime.getSnapshot()?.status === 'live') {
                this.runtime.addGeneratedChats(classification.reaction_chats, classification.source || 'model-reaction');
            }
            this.#refreshRuntimeState();

            if (response?.accepted) {
                this.composer?.clear?.();
                this.#showToast(classification.reason || '위장 채팅이 방송 여론에 반영되었습니다.');
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
     * beat 시작 2초 뒤부터 안전 폴백과 AI 채팅을 1초 간격 큐로 방출합니다.
     * @param {object} event - beat-started 런타임 이벤트입니다.
     * @returns {Promise<void>} 비동기 채팅 생성 완료 Promise입니다.
     * @private
     */
    async #generateAmbientChats(event) {
        const requestGeneration = this.asyncGeneration;
        const beatId = event.beatId;
        const fallbackChats = Array.isArray(event.fallbackChats) ? event.fallbackChats : [];
        const context = {
            topic: event.topic?.title || event.topic?.id || '',
            heroText: event.heroText || '',
            mood: event.mood || '',
            opinion: this.snapshot?.metrics?.opinion,
            fallbackChats,
            viewerIds: this.#getViewerIds(fallbackChats)
        };

        this.ambientChatBeatId = beatId;
        this.ambientChatQueue = fallbackChats.map((chat) => ({ ...chat, source: 'fallback' }));
        this.ambientChatSecondsRemaining = AMBIENT_CHAT_START_DELAY_SECONDS;

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
        if (this.ambientChatQueue.length === 0) {
            this.ambientChatSecondsRemaining = Math.max(0, this.ambientChatSecondsRemaining);
            return;
        }

        this.ambientChatSecondsRemaining -= Math.max(0, finiteNumber(deltaSeconds, 0));
        let emitted = false;
        while (this.ambientChatSecondsRemaining <= 0 && this.ambientChatQueue.length > 0) {
            const chat = this.ambientChatQueue.shift();
            this.runtime.addGeneratedChats([chat], chat?.source || 'ambient');
            this.ambientChatSecondsRemaining += AMBIENT_CHAT_INTERVAL_SECONDS;
            emitted = true;
        }
        if (emitted) {
            this.snapshot = this.runtime.getSnapshot();
        }
    }

    /** 현재 beat에 예약된 일반 채팅을 모두 폐기합니다. @private */
    #clearAmbientChatQueue() {
        this.ambientChatQueue = [];
        this.ambientChatBeatId = null;
        this.ambientChatSecondsRemaining = 0;
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
            void this.#generateAmbientChats(event);
            return;
        }
        if (event.type === 'core-chat-started') {
            this.timerMaximums.core = Math.max(
                Number.EPSILON,
                finiteNumber(
                    event.timeLimitSeconds ?? event.timeRemainingSeconds ?? event.durationSeconds,
                    AERO_LIVE_DEFAULT_TIMING.coreChatSeconds
                )
            );
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
            return;
        }
        if (event.type === 'donation-resolved') {
            this.heroResponseText = safeText(event.heroResponse, 240);
            this.heroResponseSecondsRemaining = 4.5;
            this.#showToast(event.timedOut
                ? '후원 응답 시간이 지나 자동으로 대응했습니다.'
                : (event.appropriate ? '후원 의도에 맞는 디렉션이었습니다.' : '후원 의도와 어긋난 디렉션이었습니다.'));
            return;
        }
        if (event.type === 'core-chat-resolved' && event.action === 'timeout') {
            this.#showToast('핵심 채팅 대응 시간이 지났습니다.');
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
        }
    }

    /**
     * 현재 채팅과 폴백 목록에서 AI 계약에 사용할 시청자 ID를 추출합니다.
     * @param {Array<object>} [fallbackChats=[]] - beat의 폴백 채팅입니다.
     * @returns {string[]} 최대 12개의 고유 시청자 ID입니다.
     * @private
     */
    #getViewerIds(fallbackChats = []) {
        const ids = [
            ...(Array.isArray(fallbackChats) ? fallbackChats : []),
            ...(Array.isArray(this.snapshot?.chats) ? this.snapshot.chats : [])
        ]
            .map((chat) => safeText(chat?.viewer_id || chat?.viewerId || chat?.author || chat?.nickname, 24))
            .filter(Boolean);
        const uniqueIds = [...new Set(ids)].slice(0, 12);
        return uniqueIds.length > 0 ? uniqueIds : ['aqua_fan', 'cloud_note', 'bubble_pop'];
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
