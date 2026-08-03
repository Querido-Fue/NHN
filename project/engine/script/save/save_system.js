import { path } from 'util/nw_bridge.js';
import { ProgressHandler } from './_progress_handler.js';
import { RuntimeStateHandler } from './_runtime_state_handler.js';
import { SettingHandler } from './_setting_handler.js';
import { ensureSaveDirectory } from './_save_file_helper.js';

let saveSystemInstance;

/**
 * @class SaveSystem
 * @description 엔진 런타임의 설정/진행도/상태 데이터를 NW.js 로컬 파일에 저장합니다.
 */
export class SaveSystem {
    constructor() {
        saveSystemInstance = this;
        this.dataDir = path.join(process.cwd(), 'save');

        this.settingHandler = new SettingHandler(this.dataDir);
        this.progressHandler = new ProgressHandler(this.dataDir);
        this.runtimeStateHandler = new RuntimeStateHandler(this.dataDir);
    }

    /**
     * 저장 시스템을 초기화하고 데이터를 로드합니다.
     */
    async init() {
        await ensureSaveDirectory(this.dataDir, '저장 데이터');
        await this.settingHandler.init();
        await this.progressHandler.init();
        await this.runtimeStateHandler.init();
    }

    /**
     * 특정 설정 값을 변경하고 저장합니다.
     * @param {string} key - 설정 키
     * @param {any} value - 설정 값
     * @returns {Promise} 저장 완료 Promise
     */
    setSetting(key, value) {
        return this.settingHandler.set(key, value);
    }

    /**
     * 여러 설정 값을 한 번에 변경하고 저장합니다.
     * @param {object} settings - {key: value} 형태의 설정 객체
     * @returns {Promise} 저장 완료 Promise
     */
    setSettingBatch(settings) {
        return this.settingHandler.setBatch(settings);
    }

    /**
     * 여러 설정 값을 메모리에만 임시 반영합니다.
     * @param {object} settings - {key: value} 형태의 설정 객체
     */
    previewSettingBatch(settings) {
        this.settingHandler.previewBatch(settings);
    }

    /**
     * 특정 설정 값을 가져옵니다.
     * @param {string} key - 설정 키
     * @returns {any} 설정 값. 키가 없으면 undefined 반환.
     */
    getSetting(key) {
        return this.settingHandler.get(key);
    }

    /**
     * 전체 런타임 상태 데이터를 반환합니다.
     * @returns {object} 런타임 상태 데이터 객체
     */
    getRuntimeState() {
        return this.runtimeStateHandler.getData();
    }

    /**
     * 특정 런타임 상태 값을 반환합니다.
     * @param {string} key - 런타임 상태 키
     * @returns {*} 런타임 상태 값
     */
    getRuntimeStateValue(key) {
        return this.runtimeStateHandler.getValue(key);
    }

    /**
     * 특정 런타임 상태 값을 변경하고 저장합니다.
     * @param {string} key - 런타임 상태 키
     * @param {*} value - 저장할 값
     * @returns {Promise<*>} 저장한 값
     */
    async setRuntimeStateValue(key, value) {
        this.runtimeStateHandler.setData(key, value);
        await this.runtimeStateHandler.save();
        return value;
    }

    /**
     * 런타임 상태 데이터를 저장합니다.
     * @returns {Promise<void>} 저장 완료 Promise
     */
    async saveRuntimeState() {
        await this.runtimeStateHandler.save();
    }

    /**
     * 런타임 상태 파일 경로를 반환합니다.
     * @returns {string} 런타임 상태 파일 경로
     */
    getRuntimeStateFilePath() {
        return this.runtimeStateHandler.filePath;
    }

    /**
     * 모든 데이터를 저장합니다.
     * @returns {Promise} 모든 저장 완료 Promise
     */
    async saveAll() {
        await this.settingHandler.save();
        await this.progressHandler.save();
        await this.runtimeStateHandler.save();
    }
}

/**
 * 특정 설정 값을 반환합니다.
 * @param {string} key - 설정 키
 * @returns {any} 설정 값
 */
export const getSetting = (key) => {
    return saveSystemInstance.getSetting(key);
};

/**
 * 특정 설정 값을 변경하고 저장합니다.
 * @param {string} key - 설정 키
 * @param {any} value - 설정 값
 * @returns {Promise} 저장 완료 Promise
 */
export const setSetting = (key, value) => {
    return saveSystemInstance.setSetting(key, value);
};

/**
 * 여러 설정 값을 한 번에 변경하고 저장합니다.
 * @param {object} settings - {key: value} 형태의 설정 객체
 * @returns {Promise} 저장 완료 Promise
 */
export const setSettingBatch = (settings) => {
    return saveSystemInstance.setSettingBatch(settings);
};

/**
 * 여러 설정 값을 메모리에만 임시 반영합니다.
 * @param {object} settings - {key: value} 형태의 설정 객체
 */
export const previewSettingBatch = (settings) => {
    saveSystemInstance.previewSettingBatch(settings);
};

/**
 * 특정 설정 키의 스키마(value, min, max, hidden)를 반환합니다.
 * @param {string} key - 설정 키
 * @returns {{ value: any, min: number, max: number, hidden: boolean }|undefined}
 */
export const getSettingSchema = (key) => {
    return saveSystemInstance.settingHandler.getSchema(key);
};

/**
 * 전체 런타임 상태 데이터를 반환합니다.
 * @returns {object} 런타임 상태 데이터 객체
 */
export const getRuntimeState = () => {
    return saveSystemInstance.getRuntimeState();
};

/**
 * 특정 런타임 상태 값을 반환합니다.
 * @param {string} key - 런타임 상태 키
 * @returns {*} 런타임 상태 값
 */
export const getRuntimeStateValue = (key) => {
    return saveSystemInstance.getRuntimeStateValue(key);
};

/**
 * 특정 런타임 상태 값을 변경하고 저장합니다.
 * @param {string} key - 런타임 상태 키
 * @param {*} value - 저장할 값
 * @returns {Promise<*>} 저장한 값
 */
export const setRuntimeStateValue = (key, value) => {
    return saveSystemInstance.setRuntimeStateValue(key, value);
};

/**
 * 런타임 상태 데이터를 저장합니다.
 * @returns {Promise<void>} 저장 완료 Promise
 */
export const saveRuntimeState = () => {
    return saveSystemInstance.saveRuntimeState();
};

/**
 * 런타임 상태 파일 경로를 반환합니다.
 * @returns {string} 런타임 상태 파일 경로
 */
export const getRuntimeStateFilePath = () => {
    return saveSystemInstance.getRuntimeStateFilePath();
};

/**
 * SaveSystem의 싱글톤 인스턴스를 반환합니다.
 * @returns {SaveSystem} SaveSystem 인스턴스
 */
export const getSaveSystemInstance = () => {
    return saveSystemInstance;
};
