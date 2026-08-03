import { BaseOverlay } from './_base_overlay.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { getData } from 'data/data_handler.js';

const GAME_SCENE_CONSTANTS = getData('GAME_SCENE_CONSTANTS');
const SCENE_SELECT_CONSTANTS = GAME_SCENE_CONSTANTS.SCENE_SELECT_OVERLAY;

/**
 * @class SceneSelectOverlay
 * @description 타이틀 시작 버튼 이후 임시로 사용할 씬 선택 오버레이입니다.
 */
export class SceneSelectOverlay extends BaseOverlay {
    /**
     * @param {object} systemHandler - 씬 전환을 요청할 시스템 핸들러입니다.
     */
    constructor(systemHandler) {
        super({
            layer: 90,
            dim: 0.3,
            transparent: true,
            blurUpdateMode: 'always'
        });
        this.systemHandler = systemHandler;
        this.isSceneTransitionQueued = false;
    }

    /**
     * @override
     * 선택 오버레이 크기를 화면 비율에 맞춰 조정합니다.
     */
    _onResize() {
        this.width = this.UIWW * SCENE_SELECT_CONSTANTS.WIDTH_UIWW_RATIO;
        this.height = this.WH * SCENE_SELECT_CONSTANTS.HEIGHT_WH_RATIO;
    }

    /**
     * @override
     * 씬 선택 버튼과 닫기 버튼을 생성합니다.
     */
    _generateLayout() {
        this._releaseElements();

        const layout = new LayoutHandler(this, this.positioningHandler)
            .paddingX('WW', SCENE_SELECT_CONSTANTS.PADDING_WW)
            .space('WH', SCENE_SELECT_CONSTANTS.TOP_SPACE_WH)
            .item('text', 'scene-select-title')
                .stylePreset('h2')
                .text(SCENE_SELECT_CONSTANTS.TITLE)
                .fill(ColorSchemes.Overlay.Text.Title)
                .align('center')
            .space('WH', SCENE_SELECT_CONSTANTS.TITLE_GAP_WH)
            .item('text', 'scene-select-description')
                .stylePreset('h4')
                .text(SCENE_SELECT_CONSTANTS.DESCRIPTION)
                .fill(ColorSchemes.Overlay.Text.Item)
                .align('center')
            .space('WH', SCENE_SELECT_CONSTANTS.BUTTON_GAP_WH);

        for (const option of SCENE_SELECT_CONSTANTS.OPTIONS) {
            layout
                .item('button', `scene-select-${option.id}`)
                    .stylePreset('overlay_interact_button')
                    .width('fill')
                    .height('WH', SCENE_SELECT_CONSTANTS.BUTTON_HEIGHT_WH)
                    .buttonText(option.label)
                    .buttonColor(ColorSchemes.Overlay.Button.Confirm)
                    .prop('activateOnPress', true)
                    .onClick(() => this.#startScene(option.sceneId))
                .space('WH', SCENE_SELECT_CONSTANTS.BUTTON_GAP_WH);
        }

        layout
            .bottomSpace('WH', SCENE_SELECT_CONSTANTS.FOOTER_GAP_WH)
            .bottomGroup()
                .justifyContent('right', 'WW', 1)
                .align('right')
                .item('button', 'scene-select-close')
                    .stylePreset('overlay_interact_button')
                    .buttonText('닫기')
                    .buttonColor(ColorSchemes.Overlay.Button.Cancel)
                    .prop('activateOnPress', true)
                    .onClick(this.close.bind(this))
            .endGroup();

        const result = layout.build();
        this.dynamicItems = result.dynamicItems;
        this.staticItems = result.staticItems;
        this.components = result.components;
    }

    /**
     * 선택한 게임 씬으로 전환합니다.
     * @param {string} sceneId - 전환할 씬 ID입니다.
     * @returns {void}
     * @private
     */
    #startScene(sceneId) {
        const sceneSystem = this.systemHandler?.sceneSystem;
        if (!sceneSystem?.startScene || this.isSceneTransitionQueued) {
            return;
        }

        this.isSceneTransitionQueued = true;
        void this.close().then(() => {
            sceneSystem.startScene(sceneId);
        });
    }
}
