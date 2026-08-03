/**
 * DOM KeyboardEvent.key 값을 내부 입력 키 이름으로 변환하는 매핑입니다.
 * @type {Readonly<Record<string, string>>}
 */
const KEYBOARD_ACTION_BY_DOM_KEY = Object.freeze({
    ArrowUp: 'up',
    w: 'up',
    ArrowDown: 'down',
    s: 'down',
    ArrowLeft: 'left',
    a: 'left',
    ArrowRight: 'right',
    d: 'right',
    ' ': 'space',
    p: 'pause',
    r: 'reload'
});

/**
 * 기본 키보드 입력 상태를 생성합니다.
 * @returns {{up:boolean, down:boolean, left:boolean, right:boolean, space:boolean, pause:boolean, reload:boolean}} 키 상태 객체입니다.
 */
function createDefaultKeyboardState() {
    return {
        up: false,
        down: false,
        left: false,
        right: false,
        space: false,
        pause: false,
        reload: false
    };
}

/**
 * @class KeyboardInputHandler
 * @description 키보드 입력을 관리하는 클래스입니다.
 * 키 상태 등을 추적합니다.
 */
export class KeyboardInputHandler {
    constructor() {
        this.keys = createDefaultKeyboardState();
        this.codeStates = {};
        this.domKeyStates = {};
        this.lastEvent = null;

        window.addEventListener('keydown', (e) => {
            this.#setKeyState(e, true);
        });

        window.addEventListener('keyup', (e) => {
            this.#setKeyState(e, false);
        });

        window.addEventListener('blur', () => {
            this.resetKeyboardInput();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.resetKeyboardInput();
            }
        });
    }

    /**
     * 입력 상태를 업데이트합니다.
     */
    update() {
    }

    /**
     * 키보드 입력 상태를 초기화합니다.
     */
    resetKeyboardInput() {
        this.keys = createDefaultKeyboardState();
        this.codeStates = {};
        this.domKeyStates = {};
        this.lastEvent = null;
    }

    /**
     * 키보드 관련 정보를 반환합니다.
     * @param {string} key - 요청할 데이터 키
     * @returns {any} 키보드 데이터
     */
    getKeyboardInput(key) {
        return Object.prototype.hasOwnProperty.call(this.keys, key) ? this.keys[key] : null;
    }

    /**
     * DOM code 입력 상태를 반환합니다.
     * @param {string} code - KeyboardEvent.code 값입니다.
     * @returns {boolean} 눌림 여부입니다.
     */
    getKeyboardCodeInput(code) {
        return this.codeStates[code] === true;
    }

    /**
     * 원본 키 입력 상태 스냅샷을 반환합니다.
     * @returns {{actions: object, codes: object, keys: object, lastEvent: object|null}} 키보드 스냅샷입니다.
     */
    getKeyboardSnapshot() {
        return {
            actions: { ...this.keys },
            codes: { ...this.codeStates },
            keys: { ...this.domKeyStates },
            lastEvent: this.lastEvent ? { ...this.lastEvent } : null
        };
    }

    /**
     * DOM key/code 입력을 내부 키 상태에 반영합니다.
     * @param {KeyboardEvent|string} event - KeyboardEvent 또는 KeyboardEvent.key 값입니다.
     * @param {boolean} isPressed - 눌림 여부입니다.
     * @private
     */
    #setKeyState(event, isPressed) {
        const domKey = typeof event === 'string' ? event : event?.key;
        const domCode = typeof event === 'string' ? '' : event?.code;
        const normalizedDomKey = typeof domKey === 'string' && domKey.length === 1
            ? domKey.toLowerCase()
            : domKey;

        if (domCode) {
            this.codeStates[domCode] = isPressed === true;
        }

        if (normalizedDomKey) {
            this.domKeyStates[normalizedDomKey] = isPressed === true;
        }

        this.lastEvent = {
            key: normalizedDomKey || '',
            code: domCode || '',
            pressed: isPressed === true,
            timeStamp: Number.isFinite(Number(event?.timeStamp)) ? Number(event.timeStamp) : performance.now()
        };

        const keyName = KEYBOARD_ACTION_BY_DOM_KEY[normalizedDomKey];
        if (!keyName) {
            return;
        }

        this.keys[keyName] = isPressed === true;
    }
}
