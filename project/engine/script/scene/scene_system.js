import { BaseScene } from './_base_scene.js';
import { clearSimulationCommands } from 'simulation/simulation_command_queue.js';
import { getData } from 'data/data_handler.js';
import { getCanvas, getWH, getWW, render } from 'display/display_system.js';
import { getDelta } from 'engine/time_handler.js';
import { clamp01, easeOutExpo, lerpNumber } from 'util/number_util.js';

const SCENE_STATES = Object.freeze({
    EMPTY: 'empty',
    DIAGNOSTIC: 'diagnostic',
    TITLE: 'title',
    ACTIVE: 'active'
});
const SCENE_TRANSITION_CONSTANTS = getData('SCENE_TRANSITION_CONSTANTS');
const SCENE_TRANSITION_PHASES = Object.freeze({
    IDLE: 'idle',
    FADE_IN: 'fadeIn',
    LOADING: 'loading',
    FADE_OUT: 'fadeOut'
});

/**
 * 기본 빈 씬을 생성합니다.
 * @param {SceneSystem} sceneSystem - 씬 시스템 인스턴스입니다.
 * @returns {BaseScene} 생성된 빈 씬입니다.
 */
function createDefaultScene(sceneSystem) {
    return new BaseScene(sceneSystem);
}

/**
 * 씬 factory 옵션을 정규화합니다.
 * @param {Function|undefined} factory - 외부에서 전달된 씬 factory입니다.
 * @param {Function|null} fallback - 기본 factory입니다.
 * @returns {Function} 사용할 씬 factory입니다.
 */
function normalizeSceneFactory(factory, fallback = null) {
    return typeof factory === 'function' ? factory : fallback;
}

/**
 * 이름 기반 씬 factory 맵을 정규화합니다.
 * @param {Record<string, Function>|undefined} sceneFactories - 씬 ID별 factory 맵입니다.
 * @returns {Map<string, Function>} 정규화된 factory 맵입니다.
 */
function normalizeSceneFactoryMap(sceneFactories) {
    const factoryMap = new Map();

    if (!sceneFactories || typeof sceneFactories !== 'object') {
        return factoryMap;
    }

    for (const [sceneId, factory] of Object.entries(sceneFactories)) {
        if (typeof sceneId === 'string' && sceneId && typeof factory === 'function') {
            factoryMap.set(sceneId, factory);
        }
    }

    return factoryMap;
}

/**
 * 씬에 지정한 메서드가 있으면 호출합니다.
 * @param {object|null|undefined} scene - 대상 씬 인스턴스입니다.
 * @param {string} methodName - 호출할 메서드 이름입니다.
 * @param {Array} [args=[]] - 메서드 인자 목록입니다.
 * @returns {*} 씬 메서드 반환값입니다.
 */
function callSceneMethod(scene, methodName, args = []) {
    if (scene && typeof scene[methodName] === 'function') {
        return scene[methodName](...args);
    }
    return undefined;
}

/**
 * 씬 정리 중 예외가 발생해도 전환 흐름이 멈추지 않도록 처리합니다.
 * @param {object|null|undefined} scene - 정리할 씬 인스턴스입니다.
 * @param {string} label - 로그에 사용할 씬 라벨입니다.
 * @returns {void}
 */
function destroySceneSafely(scene, label) {
    try {
        callSceneMethod(scene, 'destroy');
    } catch (error) {
        console.error(`SceneSystem: '${label}' 씬 정리 중 오류가 발생했습니다.`, error);
    }
}

/**
 * @class SceneSystem
 * @description 현재 활성 씬을 보관하고 씬 전환을 관리합니다.
 */
export class SceneSystem {
    /**
     * @param {object} systemHandler - 상위 시스템 핸들러입니다.
     * @param {{initialSceneFactory?: Function, initialSceneState?: string, playSceneFactory?: Function, sceneFactories?: Record<string, Function>, playMode?: string, benchmarkMode?: string}} [options={}] - 씬 생성 옵션입니다.
     */
    constructor(systemHandler, options = {}) {
        this.systemHandler = systemHandler;
        this.scene = null;
        this.initialSceneFactory = normalizeSceneFactory(options.initialSceneFactory, createDefaultScene);
        this.initialSceneState = typeof options.initialSceneState === 'string'
            ? options.initialSceneState
            : SCENE_STATES.EMPTY;
        this.playSceneFactory = normalizeSceneFactory(options.playSceneFactory);
        this.sceneFactories = normalizeSceneFactoryMap(options.sceneFactories);
        this.playMode = typeof options.playMode === 'string' ? options.playMode : 'play';
        this.benchmarkMode = typeof options.benchmarkMode === 'string' ? options.benchmarkMode : 'benchmark';
        this.sceneState = this.initialSceneState;
        this.transitionPhase = SCENE_TRANSITION_PHASES.IDLE;
        this.transitionAlpha = 0;
        this.transitionElapsed = 0;
        this.transitionStartAlpha = 0;
        this.transitionRequestId = 0;
        this.pendingTransition = null;
    }

    /**
     * 씬 시스템을 초기화합니다.
     * 초기 씬을 로드합니다.
     */
    async init() {
        const initialScene = await Promise.resolve(this.initialSceneFactory(this));
        await this.#waitForTransitionReady(initialScene);
        this.#setScene(initialScene, this.initialSceneState);
    }

    /**
     * 현재 씬을 업데이트합니다.
     * @param {object} [options={}] - 현재 프레임의 실행 보조 옵션입니다.
     */
    update(options = {}) {
        this.#updateTransition();
        if (this.#isTransitionActive()) {
            return;
        }

        this.#callActiveScene('update', [options]);
    }

    /**
     * 현재 씬의 고정 틱 업데이트를 호출합니다.
     */
    fixedUpdate() {
        if (this.#isTransitionActive()) {
            return;
        }

        this.#callActiveScene('fixedUpdate');
    }

    /**
     * 현재 씬을 그립니다.
     */
    draw() {
        this.#callActiveScene('draw');
    }

    /**
     * 씬 전환 중 최상단 검은 화면을 그립니다.
     */
    drawTransitionOverlay() {
        if (this.transitionAlpha <= 0) {
            return;
        }

        render('top', {
            shape: 'rect',
            x: 0,
            y: 0,
            w: getWW(),
            h: getWH(),
            fill: SCENE_TRANSITION_CONSTANTS.COVER_COLOR,
            alpha: clamp01(this.transitionAlpha)
        });
    }

    /**
     * 창 크기 변경 이벤트를 현재 활성화된 씬에 전달합니다.
     */
    resize() {
        this.#callActiveScene('resize');
    }

    /**
     * 현재 활성 씬에 런타임 설정 변경을 전달합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        this.#callActiveScene('applyRuntimeSettings', [changedSettings]);
    }

    /**
     * 현재 활성 씬에 시뮬레이션 명령 목록을 전달합니다.
     * @param {object[]} [commands=[]] - 전달할 시뮬레이션 명령 목록입니다.
     */
    applySimulationCommands(commands = []) {
        if (!Array.isArray(commands) || commands.length === 0) {
            return;
        }
        if (this.#isTransitionActive()) {
            return;
        }

        this.#callActiveScene('applySimulationCommands', [commands]);
    }

    /**
     * 초기 씬 factory를 다시 실행해 타이틀 씬으로 돌아갑니다.
     */
    startInitialScene() {
        this.#beginSceneTransition({
            label: 'initial',
            sceneState: this.initialSceneState || SCENE_STATES.TITLE,
            createScene: () => this.initialSceneFactory(this)
        });
    }

    /**
     * 등록된 이름 기반 씬을 시작합니다.
     * @param {string} sceneId - 시작할 씬 ID입니다.
     * @param {object} [options={}] - 씬 factory에 전달할 옵션입니다.
     * @returns {boolean} 전환 성공 여부입니다.
     */
    startScene(sceneId, options = {}) {
        const factory = this.sceneFactories.get(sceneId);
        if (!factory) {
            console.warn(`SceneSystem: '${sceneId}' 씬 factory가 등록되지 않았습니다.`);
            return false;
        }

        this.#beginSceneTransition({
            label: sceneId,
            sceneState: sceneId,
            createScene: () => factory(this, { ...options, sceneId })
        });
        return true;
    }

    /**
     * 플레이 씬을 시작합니다.
     */
    startPlayScene() {
        if (this.sceneFactories.has(this.playMode)) {
            this.startScene(this.playMode, { mode: this.playMode });
            return;
        }

        if (!this.playSceneFactory) {
            console.warn('SceneSystem: playSceneFactory가 등록되지 않아 startPlayScene을 무시합니다.');
            return;
        }

        this.#beginSceneTransition({
            label: this.playMode,
            sceneState: SCENE_STATES.ACTIVE,
            createScene: () => this.playSceneFactory(this, { mode: this.playMode })
        });
    }

    /**
     * 벤치마크 모드로 플레이 씬을 시작합니다.
     */
    startBenchmarkScene() {
        if (this.sceneFactories.has(this.benchmarkMode)) {
            this.startScene(this.benchmarkMode, { mode: this.benchmarkMode });
            return;
        }

        if (!this.playSceneFactory) {
            console.warn('SceneSystem: playSceneFactory가 등록되지 않아 startBenchmarkScene을 무시합니다.');
            return;
        }

        this.#beginSceneTransition({
            label: this.benchmarkMode,
            sceneState: SCENE_STATES.ACTIVE,
            createScene: () => this.playSceneFactory(this, { mode: this.benchmarkMode })
        });
    }

    /**
     * 검은 화면 fade in 이후 새 씬을 준비하고 fade out으로 이어지는 전환을 시작합니다.
     * @param {{label:string, sceneState:string, createScene:Function}} transition - 씬 생성 요청입니다.
     * @returns {void}
     * @private
     */
    #beginSceneTransition(transition) {
        clearSimulationCommands();
        this.#resetInputForSceneTransition();
        this.#setTransitionInputBlock(true);
        this.pendingTransition = transition;
        this.transitionRequestId += 1;
        this.transitionPhase = SCENE_TRANSITION_PHASES.FADE_IN;
        this.transitionElapsed = 0;
        this.transitionStartAlpha = this.transitionAlpha;
    }

    /**
     * 현재 씬 전환 애니메이션을 한 프레임 진행합니다.
     * @returns {void}
     * @private
     */
    #updateTransition() {
        if (!this.#isTransitionActive() || this.transitionPhase === SCENE_TRANSITION_PHASES.LOADING) {
            return;
        }

        const duration = Math.max(0.001, Number(SCENE_TRANSITION_CONSTANTS.FADE_SECONDS) || 0);
        this.transitionElapsed += Math.max(0, getDelta());
        const progress = clamp01(this.transitionElapsed / duration);
        const easedProgress = this.#resolveTransitionEasing(progress);

        if (this.transitionPhase === SCENE_TRANSITION_PHASES.FADE_IN) {
            this.transitionAlpha = lerpNumber(this.transitionStartAlpha, 1, easedProgress);
            if (progress >= 1) {
                this.transitionAlpha = 1;
                this.#enterTransitionLoading(this.transitionRequestId);
            }
            return;
        }

        if (this.transitionPhase === SCENE_TRANSITION_PHASES.FADE_OUT) {
            this.transitionAlpha = lerpNumber(this.transitionStartAlpha, 0, easedProgress);
            if (progress >= 1) {
                this.transitionAlpha = 0;
                this.transitionPhase = SCENE_TRANSITION_PHASES.IDLE;
                this.#setTransitionInputBlock(false);
            }
        }
    }

    /**
     * 현재 전환이 활성 상태인지 반환합니다.
     * @returns {boolean} 전환 활성 여부입니다.
     * @private
     */
    #isTransitionActive() {
        return this.transitionPhase !== SCENE_TRANSITION_PHASES.IDLE;
    }

    /**
     * 설정된 씬 전환 이징을 계산합니다.
     * @param {number} progress - 0에서 1 사이의 선형 진행률입니다.
     * @returns {number} 이징 적용 진행률입니다.
     * @private
     */
    #resolveTransitionEasing(progress) {
        if (SCENE_TRANSITION_CONSTANTS.EASING === 'easeOutExpo') {
            return easeOutExpo(progress);
        }

        return clamp01(progress);
    }

    /**
     * fade in 완료 후 새 씬 로딩 단계로 진입합니다.
     * @param {number} requestId - 현재 전환 요청 ID입니다.
     * @returns {void}
     * @private
     */
    #enterTransitionLoading(requestId) {
        this.transitionPhase = SCENE_TRANSITION_PHASES.LOADING;
        this.transitionElapsed = 0;
        void this.#loadPendingTransition(requestId);
    }

    /**
     * 대기 중인 씬을 생성하고 준비 완료 후 활성 씬으로 교체합니다.
     * @param {number} requestId - 현재 전환 요청 ID입니다.
     * @returns {Promise<void>}
     * @private
     */
    async #loadPendingTransition(requestId) {
        const transition = this.pendingTransition;
        if (!transition || requestId !== this.transitionRequestId) {
            return;
        }

        let nextScene = null;
        let sceneWasSet = false;
        const previousScene = this.scene;
        this.scene = null;

        try {
            destroySceneSafely(previousScene, this.sceneState);
            nextScene = await Promise.resolve(transition.createScene());
            if (requestId !== this.transitionRequestId) {
                destroySceneSafely(nextScene, transition.label);
                return;
            }

            await this.#waitForTransitionReady(nextScene);
            if (requestId !== this.transitionRequestId) {
                destroySceneSafely(nextScene, transition.label);
                return;
            }

            this.#setScene(nextScene, transition.sceneState);
            sceneWasSet = true;
            this.#resetInputForSceneTransition();
        } catch (error) {
            if (nextScene && !sceneWasSet) {
                destroySceneSafely(nextScene, transition.label);
            }
            console.error(`SceneSystem: '${transition.label}' 씬 전환 중 오류가 발생했습니다.`, error);
        } finally {
            if (requestId === this.transitionRequestId) {
                this.pendingTransition = null;
                this.#startTransitionFadeOut();
            }
        }
    }

    /**
     * 새 씬이 전환 fade out 전에 필요한 준비를 끝낼 때까지 기다립니다.
     * @param {object|null} scene - 새 씬 인스턴스입니다.
     * @returns {Promise<void>}
     * @private
     */
    async #waitForTransitionReady(scene) {
        if (scene && typeof scene.whenReadyForTransition === 'function') {
            await scene.whenReadyForTransition();
        }
    }

    /**
     * 새 씬 준비 후 검은 화면 fade out을 시작합니다.
     * @returns {void}
     * @private
     */
    #startTransitionFadeOut() {
        this.transitionPhase = SCENE_TRANSITION_PHASES.FADE_OUT;
        this.transitionElapsed = 0;
        this.transitionStartAlpha = this.transitionAlpha;
    }

    /**
     * 최상단 캔버스가 전환 중 포인터 입력을 가로막도록 설정합니다.
     * @param {boolean} enabled - 입력 차단 활성 여부입니다.
     * @returns {void}
     * @private
     */
    #setTransitionInputBlock(enabled) {
        const topCanvas = getCanvas('top');
        if (topCanvas) {
            topCanvas.style.pointerEvents = enabled ? 'auto' : 'none';
        }
    }

    /**
     * 현재 활성 씬의 메서드를 안전하게 호출합니다.
     * @param {string} methodName - 호출할 메서드 이름입니다.
     * @param {Array} [args=[]] - 메서드 인자 목록입니다.
     * @returns {*} 씬 메서드 반환값입니다.
     * @private
     */
    #callActiveScene(methodName, args = []) {
        return callSceneMethod(this.scene, methodName, args);
    }

    /**
     * 씬 전환 중 이전 마우스 입력이 다음 씬으로 전달되지 않도록 초기화합니다.
     * @returns {void}
     * @private
     */
    #resetInputForSceneTransition() {
        this.systemHandler?.resetMouseInputForSceneTransition?.();
    }

    /**
     * 활성 씬과 씬 상태 값을 갱신합니다.
     * @param {object} scene - 새 활성 씬입니다.
     * @param {string} sceneState - 새 씬 상태입니다.
     * @returns {void}
     * @private
     */
    #setScene(scene, sceneState) {
        this.scene = scene;
        this.sceneState = sceneState;
    }
}
