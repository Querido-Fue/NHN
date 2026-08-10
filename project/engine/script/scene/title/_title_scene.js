import { BaseScene } from 'scene/_base_scene.js';
import { getData } from 'data/data_handler.js';
import { getWH, getUIOffsetX, getUIWW, getWW, render, renderGL } from 'display/display_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getDelta } from 'engine/time_handler.js';
import { UIPool, releaseUIItem } from 'ui/_ui_pool.js';
import { waitForSceneReadyCondition } from 'scene/_scene_transition_ready.js';

const TITLE_SCENE_CONSTANTS = getData('TITLE_SCENE_CONSTANTS');
const TRANSPARENT_BUTTON_COLOR = 'rgba(255,255,255,0)';

/**
 * @class TitleScene
 * @description 타이틀 이미지와 이미지 위 투명 버튼 히트박스를 렌더링합니다.
 */
export class TitleScene extends BaseScene {
    /**
     * @param {object} sceneSystem - 씬 시스템 인스턴스입니다.
     */
    constructor(sceneSystem) {
        super(sceneSystem);
        this.elapsedSeconds = 0;
        this.buttons = [];
        this.titleImage = new Image();
        this.titleImageReady = false;
        this.titleImageFailed = false;
        this.isDestroyed = false;
        this.titleImage.onload = () => {
            this.titleImageReady = true;
        };
        this.titleImage.onerror = () => {
            this.titleImageFailed = true;
        };
        this.titleImage.src = TITLE_SCENE_CONSTANTS.TITLE_IMAGE_PATH;
        this.#syncViewport();
    }

    /**
     * @override
     */
    update() {
        this.elapsedSeconds += getDelta();
        for (const button of this.buttons) {
            button.update();
        }
    }

    /**
     * @override
     */
    draw() {
        this.#drawTitleImage();
        for (const button of this.buttons) {
            button.draw();
        }
    }

    /**
     * @override
     */
    whenReadyForTransition() {
        return waitForSceneReadyCondition(() => {
            return this.isDestroyed || this.titleImageReady || this.titleImageFailed;
        });
    }

    /**
     * @override
     */
    resize() {
        this.#syncViewport();
    }

    /**
     * @override
     */
    destroy() {
        this.isDestroyed = true;
        this.#releaseButtons();
        this.titleImage.onload = null;
        this.titleImage.onerror = null;
    }

    /**
     * 현재 화면 기준 레이아웃을 다시 계산합니다.
     * @private
     */
    #syncViewport() {
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.#buildButtons();
    }

    /**
     * 타이틀 메뉴 버튼을 생성합니다.
     * @private
     */
    #buildButtons() {
        this.#releaseButtons();

        this.buttons = TITLE_SCENE_CONSTANTS.BUTTONS.map((buttonData) => {
            const rect = this.#resolveButtonRect(buttonData);
            const button = UIPool.button.get();
            button.init({
                parent: this,
                layer: 'ui',
                x: rect.x,
                y: rect.y,
                width: rect.w,
                height: rect.h,
                radius: 0,
                margin: 0,
                itemSpacing: 0,
                color: TRANSPARENT_BUTTON_COLOR,
                idleColor: TRANSPARENT_BUTTON_COLOR,
                hoverColor: TRANSPARENT_BUTTON_COLOR,
                strokeColor: TRANSPARENT_BUTTON_COLOR,
                hoverStrokeColor: TRANSPARENT_BUTTON_COLOR,
                lineWidth: 0,
                alpha: 0,
                activateOnPress: true,
                onClick: () => this.#runButtonAction(buttonData.id)
            });
            return button;
        });
    }

    /**
     * 타이틀 메뉴 버튼을 회수합니다.
     * @private
     */
    #releaseButtons() {
        for (const button of this.buttons) {
            releaseUIItem(button);
        }
        this.buttons = [];
    }

    /**
     * 타이틀 이미지를 UI 기준 16:9 영역에 맞춰 그립니다.
     * @private
     */
    #drawTitleImage() {
        renderGL('background', {
            shape: 'rect',
            x: this.WW * 0.5,
            y: this.WH * 0.5,
            w: this.WW,
            h: this.WH,
            fill: ColorSchemes.Background
        });

        if (!this.titleImageReady) {
            return;
        }

        const rect = this.#getTitleImageRect();

        render('ui', {
            shape: 'image',
            image: this.titleImage,
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            smoothing: false
        });
    }

    /**
     * 타이틀 이미지가 표시되는 화면 영역을 반환합니다.
     * @returns {{x:number, y:number, w:number, h:number}} 타이틀 이미지 렌더 영역입니다.
     * @private
     */
    #getTitleImageRect() {
        return {
            x: this.UIOffsetX,
            y: 0,
            w: this.UIWW,
            h: this.WH
        };
    }

    /**
     * 타이틀 이미지 비율 좌표를 실제 버튼 히트박스 좌표로 변환합니다.
     * @param {{x:number, y:number, width:number, height:number}} buttonData - 이미지 기준 버튼 비율 데이터입니다.
     * @returns {{x:number, y:number, w:number, h:number}} 화면 좌표계 버튼 영역입니다.
     * @private
     */
    #resolveButtonRect(buttonData) {
        const titleRect = this.#getTitleImageRect();
        return {
            x: titleRect.x + (titleRect.w * (buttonData.x / 100)),
            y: titleRect.y + (titleRect.h * (buttonData.y / 100)),
            w: titleRect.w * (buttonData.width / 100),
            h: titleRect.h * (buttonData.height / 100)
        };
    }

    /**
     * 타이틀 메뉴 버튼 동작을 실행합니다.
     * @param {string} buttonId - 버튼 식별자입니다.
     * @private
     */
    #runButtonAction(buttonId) {
        if (buttonId === 'exitGame') {
            this.sceneSystem.systemHandler.overlayManager?.openExitOverlay?.();
        }
    }
}
