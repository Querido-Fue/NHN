import { fsPromises, path } from 'util/nw_bridge.js';
import { cloneJsonData, ensureSaveDirectory, pathExists } from './_save_file_helper.js';

/**
 * @class RuntimeStateHandler
 * @description 런타임 상태(JSON) 데이터를 NW.js 로컬 파일로 로드/병합/저장합니다.
 */
export class RuntimeStateHandler {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.filePath = path.join(this.dataDir, 'runtime_state.dat');
        this.data = {};
        this.defaultData = {};
    }

    /**
     * 런타임 상태 데이터를 로드합니다.
     */
    async init() {
        await this.#load();
    }

    /**
     * @private
     * 런타임 상태 데이터 파일을 로드합니다.
     */
    async #load() {
        const fileExists = await pathExists(this.filePath);

        if (fileExists) {
            try {
                this.data = JSON.parse(await fsPromises.readFile(this.filePath, 'utf-8'));

                // 병합 로직 (새로운 키가 추가되었을 경우를 대비)
                let updated = false;
                for (const key in this.defaultData) {
                    if (this.data[key] === undefined) {
                        this.data[key] = this.defaultData[key];
                        updated = true;
                    }
                }

                if (updated) {
                    await this.save();
                }

            } catch (e) {
                console.error('런타임 상태 데이터 로드 실패:', e);
                this.data = cloneJsonData(this.defaultData);
            }
        } else {
            this.data = cloneJsonData(this.defaultData);
            await this.save();
        }
    }

    /**
     * 런타임 상태 데이터를 저장합니다.
     * @returns {Promise} 저장 완료 Promise
     */
    async save() {
        await ensureSaveDirectory(this.dataDir, '런타임 상태 데이터');

        const dataStr = JSON.stringify(this.data, null, 4);

        try {
            await fsPromises.writeFile(this.filePath, dataStr);
        } catch (err) {
            console.error('런타임 상태 데이터 저장 실패:', err);
            throw err;
        }
    }

    /**
     * 전체 런타임 상태 데이터를 반환합니다.
     * @returns {object} 런타임 상태 데이터 객체
     */
    getData() {
        return this.data;
    }

    /**
     * 특정 키에 런타임 상태값을 설정합니다. (단일 키 업데이트용)
     * @param {string} key 저장할 키
     * @param {*} value 저장할 값
     */
    setData(key, value) {
        this.data[key] = value;
    }

    /**
     * 특정 키의 런타임 상태값을 가져옵니다.
     * @param {string} key 조회할 키
     * @returns {*} 해당하는 런타임 상태 값
     */
    getValue(key) {
        return this.data[key];
    }
}
