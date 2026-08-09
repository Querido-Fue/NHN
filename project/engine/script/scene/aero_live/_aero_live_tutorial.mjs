const VIGNETTE_DURATION_SECONDS = 0.6;
const TEXT_DURATION_SECONDS = 0.4;
const VIGNETTE_MAX_ALPHA = 0.74;

export const AERO_LIVE_TUTORIAL_STEPS = Object.freeze([
    Object.freeze({
        id: 'chat-send',
        target: 'chat',
        title: '채팅 전송',
        text: '채팅을 통해 방송에 참여하고 원하는 분위기로 채팅창을 이끌어 갈 수 있습니다.'
    }),
    Object.freeze({
        id: 'free-chat',
        target: 'free-chat-count',
        title: '채팅 횟수',
        text: '1회 방송에서 3회까지 채팅을 보낼 수 있습니다.'
    }),
    Object.freeze({
        id: 'chat-limit',
        target: 'composer',
        title: '자유 채팅 소진',
        text: '횟수가 모두 차감되면 해당 방송에서는 더 이상 채팅을 칠 수 없습니다. 적절한 채팅으로 아쿠아의 방송을 도와주세요!'
    }),
    Object.freeze({
        id: 'core-chat',
        target: 'core',
        title: '핵심 채팅 관리',
        text: '핵심 채팅을 클릭하면 강퇴하거나 삭제할 수 있습니다. 다만 너무 과하면 시청자가 떠날 수도 있으니 방송 흐름을 보며 관리해 주세요.'
    }),
    Object.freeze({
        id: 'producer-console',
        target: 'producer',
        title: '프로듀서 콘솔',
        text: '아쿠아와 방송의 상태를 확인할 수 있습니다. 후원 메시지에 적절한 반응을 하도록 도와 방송을 성장시켜 주세요!'
    })
]);

/** 0~1 범위의 값을 안전하게 제한합니다. */
function clamp01(value) {
    return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** 자연스러운 시선 이동에 사용하는 expo out 보간입니다. */
function easeOutExpo(value) {
    const progress = clamp01(value);
    return progress === 1 ? 1 : 1 - (2 ** (-10 * progress));
}

/** 설명창 퇴장에 사용하는 expo in 보간입니다. */
function easeInExpo(value) {
    const progress = clamp01(value);
    return progress === 0 ? 0 : 2 ** ((10 * progress) - 10);
}

/** 두 수를 비율로 보간합니다. */
function lerp(from, to, progress) {
    return from + ((to - from) * progress);
}

/** 유효한 사각형을 복사합니다. */
function safeRect(rect = {}) {
    return {
        x: Number.isFinite(rect.x) ? rect.x : 0,
        y: Number.isFinite(rect.y) ? rect.y : 0,
        w: Math.max(1, Number.isFinite(rect.w) ? rect.w : 1),
        h: Math.max(1, Number.isFinite(rect.h) ? rect.h : 1)
    };
}

/** 두 사각형을 모두 포함하는 사각형을 만듭니다. */
function unionRect(first, second) {
    const a = safeRect(first);
    const b = safeRect(second);
    const right = Math.max(a.x + a.w, b.x + b.w);
    const bottom = Math.max(a.y + a.h, b.y + b.h);
    return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.max(1, right - Math.min(a.x, b.x)),
        h: Math.max(1, bottom - Math.min(a.y, b.y))
    };
}

/** 레이아웃의 현재 단계 대상 영역을 반환합니다. */
function resolveTargetRect(layout, target) {
    if (target === 'free-chat-count') {
        return safeRect(layout?.freeChatCount);
    }
    if (target === 'composer') {
        return safeRect(layout?.composer);
    }
    if (target === 'producer') {
        return safeRect(layout?.left || layout?.producerContent);
    }
    if (target === 'core') {
        const coreRects = Array.isArray(layout?.coreActionRects) ? layout.coreActionRects : [];
        const actionArea = coreRects.reduce((combined, rect) => (
            combined ? unionRect(combined, rect) : safeRect(rect)
        ), null);
        return actionArea ? unionRect(layout?.chatArea, actionArea) : safeRect(layout?.chatArea);
    }
    return safeRect(layout?.chatArea || layout?.right);
}

/** 강조 사각형을 중심점과 반경 기반 비네팅 값으로 변환합니다. */
function focusFromRect(rect, layout) {
    const source = safeRect(rect);
    const minimum = Math.max(64, Number(layout?.pixelScale) * 84 || 84);
    const screenRadius = Math.max(
        Number(layout?.backdrop?.w) || 1,
        Number(layout?.backdrop?.h) || 1
    );
    return {
        x: source.x + source.w / 2,
        y: source.y + source.h / 2,
        radius: Math.min(
            screenRadius,
            Math.max(minimum, Math.hypot(source.w, source.h) * 0.62)
        ),
        rect: source
    };
}

/** 두 비네팅 초점을 보간합니다. */
function interpolateFocus(from, to, progress) {
    return {
        x: lerp(from.x, to.x, progress),
        y: lerp(from.y, to.y, progress),
        radius: lerp(from.radius, to.radius, progress),
        rect: {
            x: lerp(from.rect.x, to.rect.x, progress),
            y: lerp(from.rect.y, to.rect.y, progress),
            w: lerp(from.rect.w, to.rect.w, progress),
            h: lerp(from.rect.h, to.rect.h, progress)
        }
    };
}

/**
 * 첫 방송 시작 전 AERO LIVE 안내의 시각 타임라인과 단계 전환만 관리합니다.
 * 게임 Runtime을 변경하지 않으며 Scene이 이 객체의 활성 상태를 기준으로 Runtime을 잠급니다.
 */
export class AeroLiveTutorial {
    constructor() {
        this.phase = 'inactive';
        this.phaseElapsedSeconds = 0;
        this.stepIndex = 0;
    }

    /** 첫 단계의 비네팅 진입을 시작합니다. */
    start() {
        this.phase = 'opening-vignette';
        this.phaseElapsedSeconds = 0;
        this.stepIndex = 0;
    }

    /** 튜토리얼이 게임 입력과 고정 스텝을 잠가야 하는지 반환합니다. */
    isActive() {
        return this.phase !== 'inactive' && this.phase !== 'completed';
    }

    /** 현재 설명이 표시되어 다음 단계를 받을 수 있는지 반환합니다. */
    canAdvance() {
        return this.phase === 'waiting';
    }

    /** 현재 설명에서 다음 설명 또는 종료 타임라인으로 넘어갑니다. */
    advance() {
        if (!this.canAdvance()) {
            return false;
        }
        this.phaseElapsedSeconds = 0;
        this.phase = this.stepIndex >= AERO_LIVE_TUTORIAL_STEPS.length - 1
            ? 'closing'
            : 'switching';
        return true;
    }

    /** 명시적 시각 시간으로 튜토리얼 타임라인을 진행합니다. */
    update(deltaSeconds) {
        if (!this.isActive() || this.phase === 'waiting') {
            return false;
        }
        let remaining = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
        let changed = false;
        while (remaining > 0 && this.isActive()) {
            const duration = this.#phaseDuration();
            const missing = Math.max(0, duration - this.phaseElapsedSeconds);
            const consumed = Math.min(remaining, missing);
            this.phaseElapsedSeconds += consumed;
            remaining -= consumed;
            if (this.phaseElapsedSeconds + 0.000001 < duration) {
                break;
            }
            this.#completePhase();
            changed = true;
        }
        return changed;
    }

    /** Renderer가 읽을 현재 시각 표현 상태를 반환합니다. */
    getPresentation(layout) {
        if (!this.isActive()) {
            return null;
        }
        const currentStep = AERO_LIVE_TUTORIAL_STEPS[this.stepIndex] || AERO_LIVE_TUTORIAL_STEPS[0];
        const currentFocus = focusFromRect(resolveTargetRect(layout, currentStep.target), layout);
        const phaseProgress = clamp01(this.phaseElapsedSeconds / this.#phaseDuration());
        let focus = currentFocus;
        let vignetteAlpha = VIGNETTE_MAX_ALPHA;
        let text = null;
        let target = currentStep.target;

        if (this.phase === 'opening-vignette') {
            vignetteAlpha *= easeOutExpo(phaseProgress);
        } else if (this.phase === 'opening-text') {
            text = this.#createTextPresentation(currentStep, currentFocus, easeOutExpo(phaseProgress));
        } else if (this.phase === 'waiting') {
            text = this.#createTextPresentation(currentStep, currentFocus, 1);
        } else if (this.phase === 'switching') {
            const nextStep = AERO_LIVE_TUTORIAL_STEPS[this.stepIndex + 1] || currentStep;
            const nextFocus = focusFromRect(resolveTargetRect(layout, nextStep.target), layout);
            target = nextStep.target;
            focus = interpolateFocus(currentFocus, nextFocus, easeOutExpo(phaseProgress));
            const exitProgress = easeInExpo(this.phaseElapsedSeconds / TEXT_DURATION_SECONDS);
            text = this.#createTextPresentation(currentStep, currentFocus, 1 - exitProgress, exitProgress);
        } else if (this.phase === 'switching-text') {
            const entered = easeOutExpo(phaseProgress);
            text = this.#createTextPresentation(currentStep, currentFocus, entered);
        } else if (this.phase === 'closing') {
            vignetteAlpha *= 1 - easeOutExpo(phaseProgress);
            const exitProgress = easeInExpo(this.phaseElapsedSeconds / TEXT_DURATION_SECONDS);
            text = this.#createTextPresentation(currentStep, currentFocus, 1 - exitProgress, exitProgress);
        }

        return Object.freeze({
            active: true,
            phase: this.phase,
            canAdvance: this.canAdvance(),
            stepIndex: this.stepIndex,
            stepCount: AERO_LIVE_TUTORIAL_STEPS.length,
            target,
            vignette: Object.freeze({
                x: focus.x,
                y: focus.y,
                radius: focus.radius,
                alpha: clamp01(vignetteAlpha),
                rect: Object.freeze({ ...focus.rect })
            }),
            text: text ? Object.freeze(text) : null
        });
    }

    /** 현재 phase의 길이를 반환합니다. @private */
    #phaseDuration() {
        return this.phase === 'opening-vignette'
            || this.phase === 'switching'
            || this.phase === 'closing'
            ? VIGNETTE_DURATION_SECONDS
            : TEXT_DURATION_SECONDS;
    }

    /** 완료한 phase에 맞춰 다음 phase를 고릅니다. @private */
    #completePhase() {
        this.phaseElapsedSeconds = 0;
        if (this.phase === 'opening-vignette') {
            this.phase = 'opening-text';
            return;
        }
        if (this.phase === 'opening-text' || this.phase === 'switching-text') {
            this.phase = 'waiting';
            return;
        }
        if (this.phase === 'switching') {
            this.stepIndex += 1;
            this.phase = 'switching-text';
            return;
        }
        if (this.phase === 'closing') {
            this.phase = 'completed';
        }
    }

    /** 설명창 표시/퇴장 상태를 만듭니다. @private */
    #createTextPresentation(step, focus, opacity, exitProgress = null) {
        const visible = clamp01(opacity);
        const leaving = exitProgress === null ? null : clamp01(exitProgress);
        return {
            title: step.title,
            text: step.text,
            targetRect: focus.rect,
            opacity: visible,
            scale: leaving === null
                ? .9 + (visible * .1)
                : 1 - (leaving * .1)
        };
    }
}
