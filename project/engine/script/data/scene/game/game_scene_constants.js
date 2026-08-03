/**
 * 게임별 씬 전환과 임시 선택 오버레이에서 사용하는 정적 데이터입니다.
 */
export const GAME_SCENE_CONSTANTS = Object.freeze({
    SCENE_IDS: Object.freeze({
        TYCOON: 'tycoon',
        AERO_LIVE: 'aeroLive'
    }),
    SCENE_SELECT_OVERLAY: Object.freeze({
        WIDTH_UIWW_RATIO: 0.36,
        HEIGHT_WH_RATIO: 0.42,
        PADDING_WW: 1.7,
        TOP_SPACE_WH: 2.4,
        TITLE_GAP_WH: 1.5,
        BUTTON_GAP_WH: 1.1,
        BUTTON_HEIGHT_WH: 5.3,
        FOOTER_GAP_WH: 1.7,
        TITLE: '이동할 씬 선택',
        DESCRIPTION: '임시 진입 메뉴',
        OPTIONS: Object.freeze([
            Object.freeze({
                id: 'aeroLive',
                label: 'AERO LIVE 프로토타입',
                sceneId: 'aeroLive'
            })
        ])
    })
});
