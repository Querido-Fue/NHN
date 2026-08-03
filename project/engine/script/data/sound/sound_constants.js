/**
 * 사운드 및 배경음악 설정 상수 모음
 */
export const SOUND_CONSTANTS = Object.freeze({
    BGM: Object.freeze({
        PATH: '../asset/audio/BGM/main.mp3',
        DEFAULT_VOLUME: 100,
        AUTO_PLAY: true,
        UNLOCK_EVENTS: Object.freeze(['pointerdown', 'keydown', 'touchstart'])
    }),
    SFX: Object.freeze({
        PATH: '../asset/audio/UI/귀여운발소리or버튼.mp3',
        DEFAULT_VOLUME: 100
    }),
    DIAGNOSTIC_SAMPLE: Object.freeze({
        PATH: '../asset/audio/UI/귀여운발소리or버튼.mp3',
        DEFAULT_VOLUME: 80
    })
});
