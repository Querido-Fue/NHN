import { BaseOverlay } from './_base_overlay.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getData } from 'data/data_handler.js';
import { getSetting, previewSettingBatch, setSetting } from 'runtime/runtime_settings.js';
import { setBgmVolume, setSfxVolume } from 'sound/sound_system.js';
import { createFontString } from 'util/font_util.js';

const TITLE_SCENE_CONSTANTS = getData('TITLE_SCENE_CONSTANTS');
const SETTINGS = TITLE_SCENE_CONSTANTS.SETTINGS_OVERLAY;

/**
 * @class TitleSettingsOverlay
 * @description 타이틀 화면에서 여는 기본 설정 오버레이입니다.
 */
export class TitleSettingsOverlay extends BaseOverlay {
    /**
     * @param {object} systemHandler - 시스템 핸들러 인스턴스입니다.
     */
    constructor(systemHandler) {
        super({
            layer: 100,
            dim: 0.28,
            transparent: true,
            blurUpdateMode: 'always'
        });
        this.systemHandler = systemHandler || null;
        this.bgmVolume = getSetting('bgmVolume') ?? 100;
        this.sfxVolume = getSetting('sfxVolume') ?? 100;
    }

    /**
     * @override
     */
    _onResize() {
        this.width = this.#wh(SETTINGS.WIDTH_WH);
        this.height = this.#wh(SETTINGS.HEIGHT_WH);
    }

    /**
     * @override
     */
    _generateLayout() {
        this._releaseElements();
        this.bgmVolume = getSetting('bgmVolume') ?? this.bgmVolume;
        this.sfxVolume = getSetting('sfxVolume') ?? this.sfxVolume;

        const titleFont = this.#font(SETTINGS.TITLE_FONT_WH, 600);
        const labelFont = this.#font(SETTINGS.LABEL_FONT_WH, 700);
        const controlFont = this.#font(SETTINGS.CONTROL_FONT_WH, 700);
        const buttonFontSize = this.#wh(SETTINGS.BUTTON_FONT_WH);
        const controlBorderWidth = this.#wh(SETTINGS.CONTROL_BORDER_WH);

        const handler = new LayoutHandler(this, this.positioningHandler).paddingX('WH', SETTINGS.PADDING_WH)
            .space('WH', SETTINGS.TOP_SPACE_WH)
            .item('text', 'settings-title')
                .stylePreset('H2')
                .text('설정')
                .fill(ColorSchemes.Overlay.Text.Title)
                .prop('font', titleFont)
            .space('WH', SETTINGS.TITLE_GAP_WH)
            .item('line', 'settings-divider')
                .width('fill')
                .stroke(ColorSchemes.Overlay.Panel.Divider)
                .lineWidth(controlBorderWidth)
            .space('WH', SETTINGS.DIVIDER_GAP_WH)
            .group('bgm-row')
                .width('fill')
                .height('WH', SETTINGS.ROW_HEIGHT_WH)
                .justifyContent('left', 'WH', SETTINGS.GROUP_GAP_WH)
                .spacer('WH', SETTINGS.ROW_SIDE_PADDING_WH)
                .item('text', 'bgm-label')
                    .stylePreset('H4_BOLD')
                    .text('배경 사운드')
                    .fill(ColorSchemes.Overlay.Text.Item)
                    .prop('font', labelFont)
                    .width('WH', SETTINGS.LABEL_WIDTH_WH)
                    .vAlign('center')
                .spacer()
                .item('slider', 'bgm-volume')
                    .width('WH', SETTINGS.CONTROL_WIDTH_WH)
                    .height('WH', SETTINGS.ROW_HEIGHT_WH)
                    .valueRange(0, 100)
                    .setValue(this.bgmVolume)
                    .prop('trackHeight', this.#wh(SETTINGS.SLIDER_TRACK_HEIGHT_WH))
                    .prop('knobRadius', this.#wh(SETTINGS.SLIDER_KNOB_RADIUS_WH))
                    .prop('lineWidth', controlBorderWidth)
                    .prop('valueFont', this.#font(SETTINGS.SLIDER_VALUE_FONT_WH, 700))
                    .prop('valueOffsetY', this.#wh(SETTINGS.SLIDER_VALUE_OFFSET_WH))
                    .prop('valueTextOffsetY', this.#wh(SETTINGS.SLIDER_VALUE_TEXT_OFFSET_WH))
                    .prop('showValue', true)
                    .prop('valueFormatter', (value) => `${Math.round(value)}%`)
                    .onChange((value) => this.#previewBgmVolume(value))
                    .onCommit((value) => {
                        void this.#commitSetting('bgmVolume', value);
                    })
                    .vAlign('center')
                .spacer('WH', SETTINGS.ROW_SIDE_PADDING_WH)
            .endGroup()
            .space('WH', SETTINGS.ROW_GAP_WH)
            .group('vfx-row')
                .width('fill')
                .height('WH', SETTINGS.ROW_HEIGHT_WH)
                .justifyContent('left', 'WH', SETTINGS.GROUP_GAP_WH)
                .spacer('WH', SETTINGS.ROW_SIDE_PADDING_WH)
                .item('text', 'vfx-label')
                    .stylePreset('H4_BOLD')
                    .text('VFX 사운드')
                    .fill(ColorSchemes.Overlay.Text.Item)
                    .prop('font', labelFont)
                    .width('WH', SETTINGS.LABEL_WIDTH_WH)
                    .vAlign('center')
                .spacer()
                .item('slider', 'vfx-volume')
                    .width('WH', SETTINGS.CONTROL_WIDTH_WH)
                    .height('WH', SETTINGS.ROW_HEIGHT_WH)
                    .valueRange(0, 100)
                    .setValue(this.sfxVolume)
                    .prop('trackHeight', this.#wh(SETTINGS.SLIDER_TRACK_HEIGHT_WH))
                    .prop('knobRadius', this.#wh(SETTINGS.SLIDER_KNOB_RADIUS_WH))
                    .prop('lineWidth', controlBorderWidth)
                    .prop('valueFont', this.#font(SETTINGS.SLIDER_VALUE_FONT_WH, 700))
                    .prop('valueOffsetY', this.#wh(SETTINGS.SLIDER_VALUE_OFFSET_WH))
                    .prop('valueTextOffsetY', this.#wh(SETTINGS.SLIDER_VALUE_TEXT_OFFSET_WH))
                    .prop('showValue', true)
                    .prop('valueFormatter', (value) => `${Math.round(value)}%`)
                    .onChange((value) => this.#previewSfxVolume(value))
                    .onCommit((value) => {
                        void this.#commitSetting('sfxVolume', value);
                    })
                    .vAlign('center')
                .spacer('WH', SETTINGS.ROW_SIDE_PADDING_WH)
            .endGroup()
            .bottomSpace('WH', SETTINGS.TOP_SPACE_WH)
            .bottomGroup('settings-actions')
                .justifyContent('right', 'WH', SETTINGS.BUTTON_GAP_WH)
                .align('right')
                .item('button', 'close-settings')
                .stylePreset('OVERLAY_INTERACT_BUTTON')
                .buttonText('닫기')
                .buttonColor(ColorSchemes.Overlay.Button.Cancel)
                .icon('deny')
                .width('WH', SETTINGS.CLOSE_BUTTON_WIDTH_WH)
                .height('WH', SETTINGS.CLOSE_BUTTON_HEIGHT_WH)
                .prop('size', buttonFontSize)
                .prop('lineWidth', controlBorderWidth)
                .prop('activateOnPress', true)
                .onClick(this.close.bind(this))
            .endGroup();

        const built = handler.build();
        this.dynamicItems = built.dynamicItems;
        this.staticItems = built.staticItems;
        this.components = built.components;
    }

    /**
     * BGM 볼륨을 저장 전 미리 반영합니다.
     * @param {number} value - 0~100 볼륨 값입니다.
     * @private
     */
    #previewBgmVolume(value) {
        this.bgmVolume = value;
        previewSettingBatch({ bgmVolume: value });
        setBgmVolume(value);
    }

    /**
     * 효과음 볼륨을 저장 전 미리 반영합니다.
     * @param {number} value - 0~100 볼륨 값입니다.
     * @private
     */
    #previewSfxVolume(value) {
        this.sfxVolume = value;
        previewSettingBatch({ sfxVolume: value });
        setSfxVolume(value);
    }

    /**
     * 화면 높이 기준 비율을 픽셀 값으로 변환합니다.
     * @param {number} value - 화면 높이 백분율입니다.
     * @returns {number} 픽셀 값입니다.
     * @private
     */
    #wh(value) {
        return this.positioningHandler.parseUnit('WH', value);
    }

    /**
     * 화면 높이에 비례하는 Canvas 폰트 문자열을 생성합니다.
     * @param {number} sizeWh - 화면 높이 백분율 폰트 크기입니다.
     * @param {number} weight - 폰트 굵기입니다.
     * @returns {string} Canvas font 문자열입니다.
     * @private
     */
    #font(sizeWh, weight) {
        return createFontString({
            weight,
            sizePx: this.#wh(sizeWh),
            family: 'Pretendard Variable'
        });
    }

    /**
     * 설정 값을 저장하고 런타임 시스템에 변경을 전파합니다.
     * @param {string} key - 설정 키입니다.
     * @param {*} value - 저장할 설정 값입니다.
     * @returns {Promise<void>}
     * @private
     */
    async #commitSetting(key, value) {
        try {
            await setSetting(key, value);
            await this.systemHandler?.applyRuntimeSettings?.({ [key]: value });
        } catch (error) {
            console.warn('타이틀 설정 저장 중 오류가 발생했습니다.', error);
        }
    }
}
