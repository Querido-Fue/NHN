import { getData } from 'data/data_handler.js';
import { runtimeTool } from 'util/runtime_tool.js';

const APP_PAUSE_DATA = getData('APP_PAUSE_DATA');
const APP_PAUSE_REASONS = APP_PAUSE_DATA.REASONS;
const APP_INACTIVE_PAUSE_POLICY = APP_PAUSE_DATA.INACTIVE_POLICY;

/**
 * @class EngineApp
 * @description 엔진의 최상위 애플리케이션 루프입니다.
 * SystemHandler를 통해 시스템 tick, resize, pause, close 흐름을 관리합니다.
 */
export class EngineApp {
    /**
     * EngineApp 클래스의 생성자입니다.
     * @param {object} systemHandler - 엔진 시스템들을 관리하는 핸들러 인스턴스입니다.
     */
    constructor(systemHandler) {
        this.systemHandler = systemHandler;
        this.loopRequestId = null;
        this.running = false;
        this.forceCloseRequested = false;
        this.fixedStepSeconds = 1 / 60;
        this.maxFrameDeltaSeconds = 0.1;
        this.maxFixedStepsPerFrame = 6;
        this.accumulatorSeconds = 0;
        this.lastFrameTimestamp = 0;
        this._boundLoop = this.loop.bind(this);
        this._boundWindowActivityChange = this._handleWindowActivityChange.bind(this);
        this._attachWindowActivityListeners();
    }

    /**
     * 메인 루프를 시작합니다.
     */
    start() {
        if (this.forceCloseRequested) return;
        this._syncCursorPresentation();
        this._syncWindowActivityPauseState();
        if (!this.systemHandler.shouldKeepLoopRunning()) {
            return;
        }
        this.#resumeLoop();
    }

    /**
     * 매 프레임 실행되는 엔진 메인 루프입니다.
     * accumulator 패턴으로 고정 스텝과 렌더를 단일 루프에서 순차 처리합니다.
     * @param {number} now - requestAnimationFrame에서 전달되는 현재 시각(ms)입니다.
     */
    loop(now) {
        if (!this.running) return;
        this.loopRequestId = requestAnimationFrame(this._boundLoop);
        const shouldMeasurePerformance = this.systemHandler?.debugSystem?.shouldTrackPerformance?.() === true;
        const frameMeasureStart = shouldMeasurePerformance ? performance.now() : 0;
        try {
            if (!Number.isFinite(this.lastFrameTimestamp) || this.lastFrameTimestamp <= 0) {
                this.lastFrameTimestamp = now;
            }

            let frameDeltaSeconds = (now - this.lastFrameTimestamp) / 1000;
            this.lastFrameTimestamp = now;

            if (!Number.isFinite(frameDeltaSeconds) || frameDeltaSeconds < 0) {
                frameDeltaSeconds = this.fixedStepSeconds;
            } else if (frameDeltaSeconds > this.maxFrameDeltaSeconds) {
                frameDeltaSeconds = this.maxFrameDeltaSeconds;
            }

            const shouldAdvanceFixedStep = this.systemHandler.shouldRunFixedStep();
            let fixedStepCount = 0;
            if (shouldAdvanceFixedStep) {
                this.accumulatorSeconds += frameDeltaSeconds;

                while (this.accumulatorSeconds >= this.fixedStepSeconds && fixedStepCount < this.maxFixedStepsPerFrame) {
                    this.accumulatorSeconds -= this.fixedStepSeconds;
                    fixedStepCount++;
                }

                if (fixedStepCount >= this.maxFixedStepsPerFrame && this.accumulatorSeconds >= this.fixedStepSeconds) {
                    this.accumulatorSeconds = this.accumulatorSeconds % this.fixedStepSeconds;
                }
            } else {
                this.accumulatorSeconds = 0;
            }

            const alpha = shouldAdvanceFixedStep
                ? (this.accumulatorSeconds / this.fixedStepSeconds)
                : 0;
            this.systemHandler.tick({
                frameDeltaSeconds,
                fixedStepSeconds: this.fixedStepSeconds,
                fixedStepCount,
                fixedAlpha: alpha
            });
        } catch (e) {
            console.warn("프레임 루프 중 오류가 발생했습니다\n", e);
        } finally {
            if (shouldMeasurePerformance) {
                const frameMeasureEnd = performance.now();
                this.systemHandler?.debugSystem?.recordPerformanceSample(
                    'frame.cpu',
                    frameMeasureEnd - frameMeasureStart,
                    frameMeasureEnd
                );
            }
        }
    }

    /**
     * 메인 루프를 정지합니다.
     */
    stop() {
        if (!this.running) return;
        this.running = false;
        if (this.loopRequestId !== null) {
            cancelAnimationFrame(this.loopRequestId);
            this.loopRequestId = null;
        }
        this.accumulatorSeconds = 0;
        this.lastFrameTimestamp = 0;
    }

    /**
     * 화면 크기 변경을 시스템에 전달합니다.
     */
    resize() {
        this.systemHandler.resize();
    }

    /**
     * 지정한 이유의 일시정지 상태를 갱신합니다.
     * @param {string} reasonKey - 일시정지 이유 식별자입니다.
     * @param {boolean} isActive - 이유 활성화 여부입니다.
     * @param {object} [policy={}] - 실행 정책 오버라이드입니다.
     */
    setPauseReason(reasonKey, isActive, policy = {}) {
        this.systemHandler.setPauseReason(reasonKey, isActive, policy);
        this._syncLoopExecutionState();
    }

    /**
     * 지정한 이유의 일시정지를 해제합니다.
     * @param {string} reasonKey - 해제할 일시정지 이유 식별자입니다.
     */
    clearPauseReason(reasonKey) {
        this.setPauseReason(reasonKey, false);
    }

    /**
     * 기본 실행 정책을 기반으로 새 일시정지 정책 객체를 만듭니다.
     * @param {object} [overrides={}] - 덮어쓸 실행 정책입니다.
     * @returns {object} 정규화된 일시정지 정책입니다.
     */
    createPausePolicy(overrides = {}) {
        return this.systemHandler.createPausePolicy(overrides);
    }

    /**
     * 특정 일시정지 이유가 활성 상태인지 반환합니다.
     * @param {string} reasonKey - 검사할 일시정지 이유 식별자입니다.
     * @returns {boolean} 활성 여부입니다.
     */
    isPauseReasonActive(reasonKey) {
        return this.systemHandler.isPauseReasonActive(reasonKey);
    }

    /**
     * 앱 종료를 시도합니다.
     * 현재 overlay manager가 종료 확인 오버레이를 제공하면 해당 오버레이를 엽니다.
     * @returns {boolean} 종료 요청을 확인 오버레이로 전환했는지 여부입니다.
     */
    tryClose() {
        if (this.forceCloseRequested) {
            return false;
        }

        const overlayManager = this.systemHandler?.overlayManager;
        if (!overlayManager || typeof overlayManager.openExitOverlay !== 'function') {
            return false;
        }

        try {
            overlayManager.openExitOverlay();
            return true;
        } catch (e) {
            console.warn("종료 확인 오버레이를 여는 중 오류가 발생했습니다\n", e);
            return true;
        }
    }

    /**
     * 창 닫기 확인을 우회하고 실제 종료를 진행 중인지 반환합니다.
     * @returns {boolean} 강제 종료 진행 여부입니다.
     */
    shouldForceCloseWindow() {
        return this.forceCloseRequested;
    }

    /**
     * 앱을 종료합니다.
     * 모든 데이터를 저장한 후 창을 닫습니다.
     */
    close() {
        if (this.forceCloseRequested) {
            return;
        }

        this.forceCloseRequested = true;
        this.stop();
        this.systemHandler.saveSystem.saveAll().then(() => {
            setTimeout(() => runtimeTool().closeWindow(), 100);
        });
    }

    /**
     * @private
     * 창 활성 상태 관련 이벤트 리스너를 등록합니다.
     */
    _attachWindowActivityListeners() {
        window.addEventListener('focus', this._boundWindowActivityChange);
        window.addEventListener('blur', this._boundWindowActivityChange);
        document.addEventListener('visibilitychange', this._boundWindowActivityChange);
    }

    /**
     * @private
     * 현재 창이 엔진 진행이 가능한 활성 상태인지 반환합니다.
     * @returns {boolean} 창 활성 여부입니다.
     */
    _isWindowActive() {
        const isDocumentVisible = typeof document.hidden === 'boolean' ? !document.hidden : true;
        const hasDocumentFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
        return isDocumentVisible && hasDocumentFocus;
    }

    /**
     * @private
     * 현재 창 활성 상태를 공통 일시정지 이유에 반영합니다.
     */
    _syncWindowActivityPauseState() {
        const isWindowActive = this._isWindowActive();
        this.systemHandler.setPauseReason(
            APP_PAUSE_REASONS.APP_INACTIVE,
            !isWindowActive,
            APP_INACTIVE_PAUSE_POLICY
        );
    }

    /**
     * @private
     * 창 활성 상태 변경에 맞춰 루프 실행 여부를 동기화합니다.
     */
    _handleWindowActivityChange() {
        this._syncCursorPresentation();
        this._syncWindowActivityPauseState();
        this._syncLoopExecutionState();
    }

    /**
     * @private
     * 현재 창 활성 상태에 맞춰 시스템 커서와 UI 커서의 표시 방식을 전환합니다.
     */
    _syncCursorPresentation() {
        const isWindowActive = this._isWindowActive();
        const root = document.documentElement;
        if (root?.style) {
            root.style.cursor = isWindowActive ? 'none' : 'auto';
        }

        const uiSystem = this.systemHandler?.uiSystem;
        if (uiSystem && typeof uiSystem.setCursorVisible === 'function') {
            uiSystem.setCursorVisible(isWindowActive);
        }
    }

    /**
     * @private
     * 현재 실행 정책에 맞춰 프레임 루프를 정지하거나 재개합니다.
     */
    _syncLoopExecutionState() {
        if (this.forceCloseRequested) {
            return;
        }

        if (this.systemHandler.shouldKeepLoopRunning()) {
            this.#resumeLoop();
            return;
        }

        this.stop();
    }

    /**
     * @private
     * 메인 루프를 실제로 재개합니다.
     */
    #resumeLoop() {
        if (this.running) return;
        this.running = true;
        this.accumulatorSeconds = 0;
        this.lastFrameTimestamp = performance.now();
        this.loopRequestId = requestAnimationFrame(this._boundLoop);
    }
}
