/**
 * NW.js 및 Node.js 내장 모듈 브릿지입니다.
 * 이 프로젝트는 NW.js 전용으로 동작하므로 런타임 검증을 함께 수행합니다.
 */

const hasWindow = typeof window !== 'undefined';
const hasNw = hasWindow && typeof window.nw !== 'undefined';
const hasRequire = hasWindow && typeof window.require === 'function';
const INVALID_RUNTIME_MESSAGE = '엔진 런타임이 올바른 환경에서 실행되지 않았습니다.\nThe engine runtime is not running in the correct environment.';

if (!hasNw || !hasRequire) {
    if (hasWindow && typeof window.alert === 'function') {
        window.alert(INVALID_RUNTIME_MESSAGE);
    }
    throw new Error(INVALID_RUNTIME_MESSAGE);
}

/**
 * 현재 런타임이 NW.js인지 여부를 반환합니다.
 * @returns {boolean}
 */
export const isNwRuntime = () => true;

/**
 * nw 전역 객체
 * @type {typeof nw}
 */
export const nw = window.nw;

/**
 * fs/promises 모듈
 * @type {typeof import('fs/promises')}
 */
export const fsPromises = window.require('fs').promises;

/**
 * path 모듈
 * @type {typeof import('path')}
 */
export const path = window.require('path');
