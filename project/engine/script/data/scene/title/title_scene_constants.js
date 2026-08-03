/**
 * 타이틀 화면과 타이틀 설정창에서 사용하는 정적 레이아웃 데이터입니다.
 */
export const TITLE_SCENE_CONSTANTS = Object.freeze({
    TITLE_IMAGE_PATH: '../asset/image/title.png',
    BUTTONS: Object.freeze([
        Object.freeze({
            id: 'settings',
            x: 50.85,
            y: 76.3,
            width: 18.15,
            height: 18.7
        }),
        Object.freeze({
            id: 'exitGame',
            x: 70.1,
            y: 76.3,
            width: 18.2,
            height: 18.7
        })
    ]),
    SETTINGS_OVERLAY: Object.freeze({
        WIDTH_WH: 64,
        HEIGHT_WH: 48,
        PADDING_WH: 2.7,
        TOP_SPACE_WH: 2.5,
        TITLE_GAP_WH: 1.3,
        DIVIDER_GAP_WH: 2.0,
        ROW_GAP_WH: 3.1,
        ROW_HEIGHT_WH: 7.6,
        SEGMENT_HEIGHT_WH: 4.4,
        ROW_SIDE_PADDING_WH: 1.2,
        LABEL_WIDTH_WH: 15,
        CONTROL_WIDTH_WH: 30,
        GROUP_GAP_WH: 1.2,
        BUTTON_GAP_WH: 1.8,
        CLOSE_BUTTON_WIDTH_WH: 14,
        CLOSE_BUTTON_HEIGHT_WH: 4.2,
        TITLE_FONT_WH: 2.9,
        LABEL_FONT_WH: 2.0,
        CONTROL_FONT_WH: 1.8,
        BUTTON_FONT_WH: 1.8,
        SLIDER_VALUE_FONT_WH: 1.9,
        SLIDER_VALUE_OFFSET_WH: 1.2,
        SLIDER_VALUE_TEXT_OFFSET_WH: 0.35,
        SLIDER_TRACK_HEIGHT_WH: 1.65,
        SLIDER_KNOB_RADIUS_WH: 1.4,
        CONTROL_BORDER_WH: 0.14
    })
});
