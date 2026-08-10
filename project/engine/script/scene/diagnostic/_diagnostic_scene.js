import { BaseScene } from 'scene/_base_scene.js';
import { getWH, getUIOffsetX, getUIWW, getWW, render, renderGL } from 'display/display_system.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getMouseInput } from 'input/input_system.js';
import { getDelta } from 'engine/time_handler.js';
import { createFontString } from 'util/font_util.js';
import { UIPool, releaseUIItem } from 'ui/_ui_pool.js';
import { Icon } from 'ui/element/_icon.js';
import { DIAGNOSTIC_TEST_TYPES } from 'overlay/_diagnostic_test_overlay.js';

const DIAGNOSTIC_SCENE_STATE = Object.freeze({
    PANEL_X_UIWW: 5.8,
    PANEL_Y_WH: 9.4,
    PANEL_WIDTH_UIWW: 35.5,
    PANEL_MAX_WIDTH_UIWW: 37.5,
    PANEL_HEIGHT_WH: 70.8,
    PANEL_PADDING_UIWW: 1.75,
    BUTTON_WIDTH_UIWW: 27.0,
    BUTTON_HEIGHT_WH: 6.0,
    BUTTON_GAP_WH: 1.05
});

const DIAGNOSTIC_FONT_SPECS = Object.freeze({
    TITLE: { sizeUIWW: 2.6, min: 30, max: 46, family: 'Pretendard Variable', weight: 760 },
    SUBTITLE: { sizeUIWW: 1.25, min: 16, max: 22, family: 'Pretendard Variable', weight: 520 },
    BODY: { sizeUIWW: 1.08, min: 14, max: 19, family: 'Pretendard Variable', weight: 460 },
    BUTTON_TEXT: { sizeUIWW: 1.12, min: 15, max: 20, family: 'Pretendard Variable', weight: 720 },
    MONO: { sizeUIWW: 0.95, min: 12, max: 17, family: 'Consolas', weight: 500 },
    MONO_SMALL: { sizeUIWW: 0.78, min: 10, max: 14, family: 'Consolas', weight: 500 }
});

const DIAGNOSTIC_BUTTONS = Object.freeze([
    {
        id: 'exitOverlay',
        icon: 'confirm',
        label: 'Open Confirm Overlay',
        description: 'OverlayManager.openExitOverlay()',
        run(scene) {
            scene.sceneSystem.systemHandler.overlayManager?.openExitOverlay?.();
        }
    },
    {
        id: 'externalLinkOverlay',
        icon: 'arrow',
        label: 'Open Link Warning',
        description: 'OverlayManager.openExternalLinkWarningOverlay()',
        run(scene) {
            scene.sceneSystem.systemHandler.overlayManager?.openExternalLinkWarningOverlay?.(
                'https://example.com/engine-diagnostic'
            );
        }
    },
    {
        id: 'displayTest',
        icon: 'confirm',
        label: 'Display Test Overlay',
        description: 'window / fullscreen / render scale',
        run(scene) {
            scene.sceneSystem.systemHandler.overlayManager?.openDiagnosticTestOverlay?.(DIAGNOSTIC_TEST_TYPES.DISPLAY);
        }
    },
    {
        id: 'inputTest',
        icon: 'arrow',
        label: 'Input Test Overlay',
        description: 'keyboard / mouse / wheel states',
        run(scene) {
            scene.sceneSystem.systemHandler.overlayManager?.openDiagnosticTestOverlay?.(DIAGNOSTIC_TEST_TYPES.INPUT);
        }
    },
]);

function clampNumber(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return min;
    }
    return Math.min(Math.max(numeric, min), max);
}

function createResponsiveFont(spec, uiww) {
    return createFontString({
        sizePx: clampNumber(uiww * (spec.sizeUIWW / 100), spec.min, spec.max),
        family: spec.family,
        weight: spec.weight
    });
}

/**
 * @class DiagnosticScene
 * @description 엔진 분리 작업 중 display/input/ui/overlay/save 상태를 확인하는 진단 씬입니다.
 */
export class DiagnosticScene extends BaseScene {
    /**
     * @param {object} sceneSystem - 씬 시스템 인스턴스입니다.
     */
    constructor(sceneSystem) {
        super(sceneSystem);
        this.elapsedSeconds = 0;
        this.buttons = [];
        this.fonts = {};
        this.lastActionLabel = 'Ready';
        this.#syncViewport();
    }

    /**
     * @override
     */
    update() {
        this.elapsedSeconds += getDelta();
        for (const button of this.buttons) {
            button.item.update();
        }
    }

    /**
     * @override
     */
    draw() {
        this.#drawWebGLCheck();
        this.#drawPanel();
        this.#drawButtons();
        this.#drawMouseReadout();
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
        this.#releaseButtons();
    }

    /**
     * 화면 metric과 버튼 레이아웃을 갱신합니다.
     * @private
     */
    #syncViewport() {
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.UIOffsetX = getUIOffsetX();
        this.fonts = Object.fromEntries(
            Object.entries(DIAGNOSTIC_FONT_SPECS).map(([key, spec]) => [key, createResponsiveFont(spec, this.UIWW)])
        );
        this.panelX = this.UIOffsetX + this.#uww(DIAGNOSTIC_SCENE_STATE.PANEL_X_UIWW);
        this.panelY = this.#uwh(DIAGNOSTIC_SCENE_STATE.PANEL_Y_WH);
        this.panelW = Math.min(
            this.#uww(DIAGNOSTIC_SCENE_STATE.PANEL_WIDTH_UIWW),
            this.#uww(DIAGNOSTIC_SCENE_STATE.PANEL_MAX_WIDTH_UIWW),
            this.UIWW - (this.#uww(DIAGNOSTIC_SCENE_STATE.PANEL_X_UIWW) * 2)
        );
        this.panelH = Math.min(
            this.#uwh(DIAGNOSTIC_SCENE_STATE.PANEL_HEIGHT_WH),
            this.WH - (this.panelY * 2)
        );
        this.#buildButtons();
    }

    #uww(value) {
        return this.UIWW * (value / 100);
    }

    #uwh(value) {
        return this.WH * (value / 100);
    }

    /**
     * diagnostic 버튼 UI 요소를 생성합니다.
     * @private
     */
    #buildButtons() {
        this.#releaseButtons();

        const panelPadding = this.#uww(DIAGNOSTIC_SCENE_STATE.PANEL_PADDING_UIWW);
        const x = this.panelX + panelPadding;
        const firstY = this.panelY + this.#uwh(23.8);
        const width = Math.min(
            this.#uww(DIAGNOSTIC_SCENE_STATE.BUTTON_WIDTH_UIWW),
            this.panelW - (panelPadding * 2)
        );
        const buttonHeight = this.#uwh(DIAGNOSTIC_SCENE_STATE.BUTTON_HEIGHT_WH);
        const buttonGap = this.#uwh(DIAGNOSTIC_SCENE_STATE.BUTTON_GAP_WH);

        this.buttons = DIAGNOSTIC_BUTTONS.map((button, index) => {
            const y = firstY + (buttonHeight + buttonGap) * index;
            const contentColor = ColorSchemes?.Overlay?.Text?.Title || '#ffffff';
            const iconElement = new Icon(button.icon || 'arrow', contentColor);
            const textElement = UIPool.text_element.get();
            textElement.init({
                parent: this,
                layer: 'ui',
                text: button.label,
                font: 'Pretendard Variable',
                fontWeight: 680,
                size: clampNumber(this.#uww(1.08), 15, 20),
                color: contentColor,
                align: 'left'
            });

            const item = UIPool.button.get();
            item.init({
                parent: this,
                layer: 'ui',
                x,
                y,
                width,
                height: buttonHeight,
                left: [iconElement, textElement],
                margin: this.#uww(0.85),
                itemSpacing: this.#uww(0.62),
                radius: this.#uwh(0.65),
                color: contentColor,
                idleColor: 'rgba(0,0,0,0)',
                hoverColor: ColorSchemes?.Overlay?.Button?.Confirm?.Idle || 'rgba(42,125,255,0.88)',
                activateOnPress: true,
                onClick: () => {
                    this.lastActionLabel = button.label;
                    button.run(this);
                }
            });

            return {
                meta: button,
                item,
                descriptionX: x + this.#uww(3.65),
                descriptionY: y + (buttonHeight * 0.78)
            };
        });
    }

    /**
     * diagnostic 버튼 UI 요소를 회수합니다.
     * @private
     */
    #releaseButtons() {
        for (const button of this.buttons) {
            releaseUIItem(button.item);
        }
        this.buttons = [];
    }

    /**
     * WebGL 레이어의 기본 배경을 그립니다.
     * @private
     */
    #drawWebGLCheck() {
        renderGL('background', {
            shape: 'rect',
            x: this.WW * 0.5,
            y: this.WH * 0.5,
            w: this.WW,
            h: this.WH,
            fill: ColorSchemes.Background || '#10131c'
        });
    }

    /**
     * 2D UI 레이어에 진단 패널을 그립니다.
     * @private
     */
    #drawPanel() {
        render('ui', {
            shape: 'roundRect',
            x: this.panelX,
            y: this.panelY,
            w: this.panelW,
            h: this.panelH,
            radius: this.#uwh(1.8),
            fill: ColorSchemes?.Overlay?.Panel?.GlassBackground || 'rgba(18,22,32,0.78)',
            stroke: ColorSchemes?.Overlay?.Panel?.Border || 'rgba(255,255,255,0.16)',
            lineWidth: 1.4,
            shadowBlur: this.#uww(1.5),
            shadowColor: 'rgba(0,0,0,0.35)'
        });

        const textX = this.panelX + this.#uww(DIAGNOSTIC_SCENE_STATE.PANEL_PADDING_UIWW);
        render('ui', {
            shape: 'text',
            x: textX,
            y: this.panelY + this.#uwh(7.8),
            text: 'JukChang Engine',
            font: this.fonts.TITLE,
            fill: ColorSchemes?.Overlay?.Text?.Title || '#ffffff',
            baseline: 'middle'
        });
        render('ui', {
            shape: 'text',
            x: textX,
            y: this.panelY + this.#uwh(12.1),
            text: 'Diagnostic Runtime',
            font: this.fonts.SUBTITLE,
            fill: ColorSchemes?.Overlay?.Text?.Item || 'rgba(255,255,255,0.72)',
            baseline: 'middle'
        });
        render('ui', {
            shape: 'text',
            x: textX,
            y: this.panelY + this.#uwh(17.7),
            text: 'Checks: WebGL, UI elements, overlay, save, display, input.',
            font: this.fonts.BODY,
            fill: ColorSchemes?.Overlay?.Text?.Sub || 'rgba(255,255,255,0.62)',
            baseline: 'middle'
        });
        render('ui', {
            shape: 'text',
            x: textX,
            y: this.panelY + this.#uwh(22.4),
            text: `Last action: ${this.lastActionLabel}`,
            font: this.fonts.MONO,
            fill: ColorSchemes?.Overlay?.Control?.Accent || '#82d7ff',
            baseline: 'middle'
        });
    }

    /**
     * diagnostic 버튼 UI 요소를 렌더링합니다.
     * @private
     */
    #drawButtons() {
        for (const button of this.buttons) {
            render('ui', {
                shape: 'line',
                x1: button.item.x + this.#uww(0.85),
                y1: button.item.y - this.#uwh(0.35),
                x2: button.item.x + button.item.width - this.#uww(0.85),
                y2: button.item.y - this.#uwh(0.35),
                stroke: ColorSchemes?.Overlay?.Panel?.Divider || 'rgba(255,255,255,0.08)',
                lineWidth: 1
            });
            button.item.draw();
            render('ui', {
                shape: 'text',
                x: button.descriptionX,
                y: button.descriptionY,
                text: button.meta.description,
                font: this.fonts.MONO_SMALL,
                fill: ColorSchemes?.Overlay?.Text?.Sub || 'rgba(255,255,255,0.58)',
                baseline: 'middle'
            });
        }
    }

    /**
     * 현재 마우스 좌표를 렌더링합니다.
     * @private
     */
    #drawMouseReadout() {
        const mousePos = getMouseInput('pos') || { x: 0, y: 0 };
        render('top', {
            shape: 'text',
            x: this.UIOffsetX + this.UIWW - this.#uww(1.7),
            y: this.WH - this.#uwh(3.0),
            text: `mouse ${Math.round(mousePos.x)}, ${Math.round(mousePos.y)}`,
            font: this.fonts.MONO,
            fill: ColorSchemes?.Debug?.Text || 'rgba(255,255,255,0.72)',
            align: 'right',
            baseline: 'bottom'
        });
    }
}
