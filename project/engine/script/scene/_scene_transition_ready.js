import { getData } from 'data/data_handler.js';

const SCENE_TRANSITION_CONSTANTS = getData('SCENE_TRANSITION_CONSTANTS');

/**
 * 이미지 캐시 레코드들이 로드 성공 또는 실패로 모두 결론 났는지 확인합니다.
 * @param {Iterable<{ready?: boolean, failed?: boolean}>} records - 이미지 캐시 레코드 목록입니다.
 * @returns {boolean} 모든 이미지가 준비 또는 실패 상태이면 true입니다.
 */
export function areSceneImageRecordsSettled(records) {
    for (const record of records) {
        if (!record?.ready && !record?.failed) {
            return false;
        }
    }

    return true;
}

/**
 * 조건이 true가 될 때까지 짧은 간격으로 기다립니다.
 * @param {Function} isReady - 준비 완료 여부를 반환하는 함수입니다.
 * @returns {Promise<void>} 준비 완료 Promise입니다.
 */
export function waitForSceneReadyCondition(isReady) {
    if (typeof isReady !== 'function' || isReady()) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const poll = () => {
            if (isReady()) {
                resolve();
                return;
            }

            globalThis.setTimeout(poll, SCENE_TRANSITION_CONSTANTS.READY_POLL_MS);
        };

        poll();
    });
}
