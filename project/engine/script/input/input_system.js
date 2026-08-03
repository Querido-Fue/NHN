import { MouseInputHandler } from './_mouse_input_handler.js';
import { KeyboardInputHandler } from './_keyboard_input_handler.js';
import { resolveFiniteNumber } from 'util/number_util.js';

let inputSystemInstance = null;

/**
 * @class InputSystem
 * @description 엔진의 마우스 및 키보드 입력을 처리하고 관리하는 시스템입니다.
 */
export class InputSystem {
    constructor() {
        inputSystemInstance = this;
        this.mouseInputHandler = new MouseInputHandler();
        this.keyboardInputHandler = new KeyboardInputHandler();
    }

    async init() {
    }

    draw() {
    }

    /**
     * 입력 시스템의 상태를 업데이트합니다.
     * 마우스와 키보드 입력을 처리합니다.
     */
    update() {
        this.mouseInputHandler.update();
        this.keyboardInputHandler.update();
    }

    /**
     * 마우스와 키보드 입력 상태를 모두 초기화합니다.
     * 창 비활성화 후 복귀 시 남아 있는 눌림 상태를 제거합니다.
     * @param {{mouseInactive?: boolean}} [options={}] - 마우스를 inactive 상태로 둘지 여부입니다.
     */
    resetAllInputState(options = {}) {
        this.mouseInputHandler.resetMouseInput({ inactive: options.mouseInactive === true });
        this.keyboardInputHandler.resetKeyboardInput();
    }

    /**
     * 마우스 입력 상태와 필요 시 포커스 레이어를 초기화합니다.
     * 씬 전환 직후 이전 클릭이 새 씬에 전달되지 않게 할 때 사용합니다.
     * @param {{inactive?: boolean, resetFocus?: boolean}} [options={}] - 마우스 초기화 옵션입니다.
     */
    resetMouseInputState(options = {}) {
        this.mouseInputHandler.resetMouseInput({
            inactive: options.inactive === true,
            resetFocus: options.resetFocus === true
        });
    }

    /**
     * 시뮬레이션 런타임에 전달할 입력 스냅샷을 생성합니다.
     * @returns {{mousePos: {x: number, y: number}, mouseButtons: {left: string[], right: string[], middle: string[]}, focusList: string[], keys: Record<string, boolean>}}
     */
    getSimulationInputSnapshot() {
        const mouseButtons = this.mouseInputHandler?.mouseButtons || {};
        const keyboardKeys = this.keyboardInputHandler?.keys || {};
        const keyboardSnapshot = this.keyboardInputHandler?.getKeyboardSnapshot?.() || { codes: {}, keys: {} };
        const mouseWheel = this.mouseInputHandler?.getMouseInput?.('wheel') || {
            deltaX: 0,
            deltaY: 0,
            lastDeltaX: 0,
            lastDeltaY: 0,
            active: false,
            eventCount: 0
        };

        return {
            mousePos: {
                x: resolveFiniteNumber(Number(this.mouseInputHandler?.mousePos?.x), 0),
                y: resolveFiniteNumber(Number(this.mouseInputHandler?.mousePos?.y), 0)
            },
            mouseButtons: {
                left: Array.isArray(mouseButtons.left?.state) ? [...mouseButtons.left.state] : ['idle'],
                right: Array.isArray(mouseButtons.right?.state) ? [...mouseButtons.right.state] : ['idle'],
                middle: Array.isArray(mouseButtons.middle?.state) ? [...mouseButtons.middle.state] : ['idle']
            },
            mouseWheel,
            focusList: Array.isArray(this.mouseInputHandler?.focusList)
                ? [...this.mouseInputHandler.focusList]
                : ['ui', 'object'],
            keys: { ...keyboardKeys },
            keyCodes: { ...keyboardSnapshot.codes },
            domKeys: { ...keyboardSnapshot.keys }
        };
    }
}

/**
 * 마우스 입력 상태를 반환합니다.
 * @param {string} key - 입력 키 (x, y, left, right, middle 등)
 * @returns {any} 마우스 입력 값
 */
export const getMouseInput = (key) => inputSystemInstance.mouseInputHandler.getMouseInput(key);

/**
 * 지정한 마우스 버튼 상태 배열에 특정 상태가 포함되어 있는지 검사합니다.
 * @param {'left'|'right'|'middle'} button - 검사할 버튼 이름
 * @param {'inactive'|'idle'|'click'|'clicking'|'clicked'} state - 검사할 상태 이름
 * @param {{includeConsumed?: boolean}} [options={}] - 소비된 상태 포함 여부 옵션입니다.
 * @returns {boolean} 상태 포함 여부
 */
export const hasMouseState = (button, state, options = {}) => inputSystemInstance.mouseInputHandler.hasButtonState(button, state, options);

/**
 * 지정한 마우스 버튼의 단발성 상태를 소비 처리합니다.
 * 현재는 `clicked` 상태만 소비 대상으로 사용합니다.
 * @param {'left'|'right'|'middle'} button - 소비할 버튼 이름입니다.
 * @param {'clicked'} [state='clicked'] - 소비할 상태 이름입니다.
 * @returns {boolean} 실제로 소비되었으면 true를 반환합니다.
 */
export const consumeMouseState = (button, state = 'clicked') => inputSystemInstance.mouseInputHandler.consumeButtonState(button, state);

/**
 * 지정한 마우스 버튼이 현재 눌림 계열 상태인지 반환합니다.
 * `click`과 `clicking`을 동일한 누름 계열로 취급합니다.
 * @param {'left'|'right'|'middle'} button - 검사할 버튼 이름
 * @returns {boolean} 누름 계열 상태 여부
 */
export const isMousePressing = (button) => hasMouseState(button, 'click') || hasMouseState(button, 'clicking');
/**
 * 현재 마우스 포커스 레이어를 반환합니다.
 * @returns {string} 포커스 레이어 이름
 */
export const getMouseFocus = () => inputSystemInstance.mouseInputHandler.focusList;

/**
 * 마우스 포커스를 추가합니다.
 * @param {string} focus - 추가할 포커스 레이어
 */
export const addMouseFocus = (focus) => inputSystemInstance.mouseInputHandler.addFocus(focus);

/**
 * 마우스 포커스를 제거합니다.
 * @param {string} focus - 제거할 포커스 레이어
 */
export const removeMouseFocus = (focus) => inputSystemInstance.mouseInputHandler.removeFocus(focus);
/**
 * 마우스 포커스 레이어를 설정합니다.
 * @param {string} focus - 포커스 레이어 이름
 */
export const setMouseFocus = (focus) => inputSystemInstance.mouseInputHandler.setFocus(focus);
/**
 * 키보드 키 입력 상태를 반환합니다.
 * @param {string} key - 키 코드 (예: 'ArrowUp', 'Space')
 * @returns {boolean} 키 눌림 여부
 */
export const getKeyboardInput = (key) => inputSystemInstance.keyboardInputHandler.getKeyboardInput(key);
/**
 * KeyboardEvent.code 기준 키 입력 상태를 반환합니다.
 * @param {string} code - KeyboardEvent.code 값입니다.
 * @returns {boolean} 키 눌림 여부
 */
export const getKeyboardCodeInput = (code) => inputSystemInstance.keyboardInputHandler.getKeyboardCodeInput(code);
/**
 * 키보드 원본 입력 상태 스냅샷을 반환합니다.
 * @returns {{actions: object, codes: object, keys: object, lastEvent: object|null}} 키보드 스냅샷
 */
export const getKeyboardSnapshot = () => inputSystemInstance.keyboardInputHandler.getKeyboardSnapshot();
/**
 * 키보드 입력 상태를 초기화합니다.
 */
export const resetKeyboardInput = () => inputSystemInstance.keyboardInputHandler.resetKeyboardInput();
