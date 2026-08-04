import { getSetting } from 'save/save_system.js';
import { getData } from 'data/data_handler.js';
import { clampFiniteNumber } from 'util/number_util.js';

const SOUND_CONSTANTS = getData('SOUND_CONSTANTS');

let soundSystemInstance = null;

/**
 * @class SoundSystem
 * @description 배경음(BGM) 리소스 초기화, 재생, 볼륨 반영을 담당합니다.
 */
export class SoundSystem {
    #lastBgmVolume;
    #lastSfxVolume;
    #pendingAutoplay;
    #unlockEvents;
    #unlockAndPlayHandler;
    #isUnlockListenerAttached;
    #runtimeSuspended;
    #resumePlaybackAfterRuntimeSuspend;

    constructor() {
        soundSystemInstance = this;
        this.bgmAudio = null;
        this.sfxSampleAudio = null;
        this.diagnosticSampleAudio = null;
        this.#lastBgmVolume = null;
        this.#lastSfxVolume = null;
        this.#pendingAutoplay = false;
        this.#unlockEvents = [...SOUND_CONSTANTS.BGM.UNLOCK_EVENTS];
        this.#unlockAndPlayHandler = this.#unlockAndPlay.bind(this);
        this.#isUnlockListenerAttached = false;
        this.#runtimeSuspended = false;
        this.#resumePlaybackAfterRuntimeSuspend = false;
    }

    /**
     * 사운드 시스템을 초기화하고 BGM 재생을 시작합니다.
     */
    async init() {
        this.bgmAudio = new Audio(SOUND_CONSTANTS.BGM.PATH);
        this.bgmAudio.loop = true;
        this.bgmAudio.preload = 'auto';
        this.#syncBgmVolume();
        this.sfxSampleAudio = new Audio(SOUND_CONSTANTS.SFX.PATH);
        this.sfxSampleAudio.loop = false;
        this.sfxSampleAudio.preload = 'auto';
        this.#syncSfxVolume();
        this.diagnosticSampleAudio = new Audio(SOUND_CONSTANTS.DIAGNOSTIC_SAMPLE.PATH);
        this.diagnosticSampleAudio.loop = false;
        this.diagnosticSampleAudio.preload = 'auto';
        this.setDiagnosticSampleVolume(SOUND_CONSTANTS.DIAGNOSTIC_SAMPLE.DEFAULT_VOLUME);

        if (SOUND_CONSTANTS.BGM.AUTO_PLAY !== false) {
            // 자동재생 Promise는 오디오 장치/브라우저 정책에 따라 사용자 입력까지
            // 보류될 수 있으므로 게임의 전체 시스템 초기화를 막지 않습니다.
            void this.playBgm();
        }
    }

    /**
     * 설정값 변경 시 BGM 볼륨을 동기화합니다.
     */
    update() {
        this.#syncBgmVolume();
        this.#syncSfxVolume();
    }

    /**
     * 사운드 정보를 그립니다.
     */
    draw() {
    }

    /**
     * BGM 재생을 시도합니다.
     */
    async playBgm() {
        if (!this.bgmAudio) return;
        if (this.#runtimeSuspended) {
            this.#pendingAutoplay = true;
            this.#resumePlaybackAfterRuntimeSuspend = true;
            return;
        }

        try {
            // play()가 reject하지 않고 사용자 입력까지 pending으로 남는 구현도 있으므로
            // await 전에 unlock 재시도 경로를 준비합니다.
            this.#pendingAutoplay = true;
            this.#attachUnlockListeners();
            await this.bgmAudio.play();
            if (this.#runtimeSuspended) {
                this.bgmAudio.pause();
                this.#resumePlaybackAfterRuntimeSuspend = true;
                return;
            }
            this.#pendingAutoplay = false;
            this.#detachUnlockListeners();
        } catch (e) {
            this.#pendingAutoplay = true;
            try {
                this.#attachUnlockListeners();
            } catch {
                // 자동재생 보조 리스너 실패가 게임 런타임까지 거절시키지 않게 합니다.
            }
        }
    }

    /**
     * BGM을 일시정지합니다.
     */
    pauseBgm() {
        if (!this.bgmAudio) return;
        this.bgmAudio.pause();
    }

    /**
     * BGM을 정지하고 재생 위치를 처음으로 되돌립니다.
     */
    stopBgm() {
        if (!this.bgmAudio) return;
        this.#pendingAutoplay = false;
        this.#resumePlaybackAfterRuntimeSuspend = false;
        this.bgmAudio.pause();
        this.bgmAudio.currentTime = 0;
    }

    /**
     * 런타임 일시정지 상태를 반영하여 BGM 재생을 멈추거나 재개합니다.
     * 창 비활성화와 향후 일시정지 메뉴가 공통으로 사용할 수 있습니다.
     * @param {boolean} isSuspended - 런타임 정지 여부입니다.
     */
    setRuntimeSuspended(isSuspended) {
        const nextSuspended = isSuspended === true;
        if (this.#runtimeSuspended === nextSuspended) {
            return;
        }

        this.#runtimeSuspended = nextSuspended;
        if (nextSuspended) {
            this.#resumePlaybackAfterRuntimeSuspend = this.#pendingAutoplay
                || Boolean(this.bgmAudio && this.bgmAudio.paused === false);
            this.pauseBgm();
            return;
        }

        const shouldResumePlayback = this.#resumePlaybackAfterRuntimeSuspend;
        this.#resumePlaybackAfterRuntimeSuspend = false;
        if (shouldResumePlayback) {
            void this.playBgm();
        }
    }

    /**
     * BGM 볼륨(0~100)을 즉시 반영합니다.
     * @param {number} volume
     */
    setBgmVolume(volume) {
        if (!this.bgmAudio) return;
        const normalized = this.#normalizeVolume(volume);
        this.#lastBgmVolume = this.#sanitizeVolume(volume);
        this.bgmAudio.volume = normalized;
    }

    /**
     * 효과음 볼륨(0~100)을 즉시 반영합니다.
     * @param {number} volume - 0~100 볼륨입니다.
     */
    setSfxVolume(volume) {
        if (!this.sfxSampleAudio) return;
        const normalized = this.#normalizeVolume(volume);
        this.#lastSfxVolume = this.#sanitizeVolume(volume);
        this.sfxSampleAudio.volume = normalized;
    }

    /**
     * 진단용 샘플 사운드를 재생합니다.
     * @param {{restart?: boolean, volume?: number}} [options={}] - 재생 옵션입니다.
     * @returns {Promise<void>}
     */
    async playDiagnosticSample(options = {}) {
        if (!this.diagnosticSampleAudio) return;

        if (options.volume !== undefined) {
            this.setDiagnosticSampleVolume(options.volume);
        }

        if (options.restart !== false) {
            this.diagnosticSampleAudio.currentTime = 0;
        }

        await this.diagnosticSampleAudio.play();
    }

    /**
     * 진단용 샘플 사운드를 일시정지합니다.
     */
    pauseDiagnosticSample() {
        if (!this.diagnosticSampleAudio) return;
        this.diagnosticSampleAudio.pause();
    }

    /**
     * 진단용 샘플 사운드를 정지하고 처음으로 되돌립니다.
     */
    stopDiagnosticSample() {
        if (!this.diagnosticSampleAudio) return;
        this.diagnosticSampleAudio.pause();
        this.diagnosticSampleAudio.currentTime = 0;
    }

    /**
     * 진단용 샘플 사운드 볼륨을 즉시 반영합니다.
     * @param {number} volume - 0~100 볼륨입니다.
     */
    setDiagnosticSampleVolume(volume) {
        if (!this.diagnosticSampleAudio) return;
        this.diagnosticSampleAudio.volume = this.#normalizeVolume(volume);
    }

    /**
     * 진단용 샘플 사운드 상태를 반환합니다.
     * @returns {{path: string, paused: boolean, currentTime: number, duration: number, volume: number}}
     */
    getDiagnosticSampleState() {
        const audio = this.diagnosticSampleAudio;
        return {
            path: SOUND_CONSTANTS.DIAGNOSTIC_SAMPLE.PATH,
            paused: audio ? audio.paused : true,
            currentTime: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
            duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0,
            volume: audio ? Math.round(audio.volume * SOUND_CONSTANTS.BGM.DEFAULT_VOLUME) : 0
        };
    }

    /**
     * 입력된 볼륨 값이 유효한 숫자인지 확인하고 0~100 범위로 보정합니다.
     * @param {number|string} value - 검사할 볼륨 수치입니다.
     * @returns {number} 안전하게 정규화된 0~100 사이 볼륨값입니다.
     * @private
     */
    #sanitizeVolume(value) {
        return clampFiniteNumber(
            Number(value),
            0,
            SOUND_CONSTANTS.BGM.DEFAULT_VOLUME,
            SOUND_CONSTANTS.BGM.DEFAULT_VOLUME
        );
    }

    /**
     * Audio 요소에 대입할 수 있는 0.0~1.0 실수 스케일로 변환합니다.
     * @param {number|string} value - 변경할 볼륨입니다.
     * @returns {number} Audio API용 볼륨 계수입니다.
     * @private
     */
    #normalizeVolume(value) {
        return this.#sanitizeVolume(value) / SOUND_CONSTANTS.BGM.DEFAULT_VOLUME;
    }

    /**
     * 설정(save_system)의 현재 볼륨 값을 확인하여 브라우저 Audio 객체에 동기화합니다.
     * @private
     */
    #syncBgmVolume() {
        if (!this.bgmAudio) return;

        const settingVolume = this.#sanitizeVolume(getSetting('bgmVolume'));
        if (this.#lastBgmVolume === settingVolume) {
            return;
        }

        this.#lastBgmVolume = settingVolume;
        this.bgmAudio.volume = settingVolume / SOUND_CONSTANTS.BGM.DEFAULT_VOLUME;
    }

    /**
     * 설정(save_system)의 현재 효과음 볼륨 값을 확인하여 브라우저 Audio 객체에 동기화합니다.
     * @private
     */
    #syncSfxVolume() {
        if (!this.sfxSampleAudio) return;

        const settingVolume = this.#sanitizeVolume(getSetting('sfxVolume'));
        if (this.#lastSfxVolume === settingVolume) {
            return;
        }

        this.#lastSfxVolume = settingVolume;
        this.sfxSampleAudio.volume = settingVolume / SOUND_CONSTANTS.SFX.DEFAULT_VOLUME;
    }

    /**
     * 브라우저 오디오 자동재생 정책에 의해 막혔을 때 사용자 첫 상호작용 후 재생되도록 이벤트를 겁니다.
     * @private
     */
    #attachUnlockListeners() {
        if (this.#isUnlockListenerAttached || typeof window === 'undefined') {
            return;
        }

        this.#unlockEvents.forEach((eventName) => {
            window.addEventListener(eventName, this.#unlockAndPlayHandler, { once: true });
        });
        this.#isUnlockListenerAttached = true;
    }

    /**
     * 오디오 잠금 해제 이벤트 리스너를 정리/제거합니다.
     * @private
     */
    #detachUnlockListeners() {
        if (!this.#isUnlockListenerAttached || typeof window === 'undefined') {
            return;
        }

        this.#unlockEvents.forEach((eventName) => {
            window.removeEventListener(eventName, this.#unlockAndPlayHandler);
        });
        this.#isUnlockListenerAttached = false;
    }

    /**
     * 사용자 상호작용 후 브라우저 오디오 재생 제한이 풀리면 대기 중인 BGM을 틀어줍니다.
     * @private
     */
    async #unlockAndPlay() {
        this.#detachUnlockListeners();
        if (!this.#pendingAutoplay) return;
        await this.playBgm();
    }
}

/**
 * 싱글톤 사운드 시스템 인스턴스를 반환합니다.
 * @returns {SoundSystem|null}
 */
export const getSoundSystemInstance = () => soundSystemInstance;

/**
 * BGM 재생을 요청합니다.
 */
export const playBgm = () => soundSystemInstance?.playBgm();

/**
 * BGM 정지를 요청합니다.
 */
export const stopBgm = () => soundSystemInstance?.stopBgm();

/**
 * BGM 볼륨 변경을 요청합니다.
 * @param {number} volume - 0~100
 */
export const setBgmVolume = (volume) => soundSystemInstance?.setBgmVolume(volume);

/**
 * 효과음 볼륨 변경을 요청합니다.
 * @param {number} volume - 0~100
 */
export const setSfxVolume = (volume) => soundSystemInstance?.setSfxVolume(volume);

/**
 * 진단용 샘플 사운드를 재생합니다.
 * @param {{restart?: boolean, volume?: number}} [options={}]
 */
export const playDiagnosticSample = (options = {}) => soundSystemInstance?.playDiagnosticSample(options);

/**
 * 진단용 샘플 사운드를 일시정지합니다.
 */
export const pauseDiagnosticSample = () => soundSystemInstance?.pauseDiagnosticSample();

/**
 * 진단용 샘플 사운드를 정지합니다.
 */
export const stopDiagnosticSample = () => soundSystemInstance?.stopDiagnosticSample();

/**
 * 진단용 샘플 사운드 볼륨을 변경합니다.
 * @param {number} volume - 0~100
 */
export const setDiagnosticSampleVolume = (volume) => soundSystemInstance?.setDiagnosticSampleVolume(volume);

/**
 * 진단용 샘플 사운드 상태를 반환합니다.
 */
export const getDiagnosticSampleState = () => soundSystemInstance?.getDiagnosticSampleState();
