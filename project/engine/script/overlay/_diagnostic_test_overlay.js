import { BaseOverlay } from './_base_overlay.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getBaseWH, getBaseWW, getDisplaySystem, getWH, getWW, measureText, render } from 'display/display_system.js';
import {
    getKeyboardCodeInput,
    getKeyboardSnapshot,
    getMouseInput,
    hasMouseState,
    isMousePressing
} from 'input/input_system.js';
import { LayoutHandler } from 'ui/layout/_layout_handler.js';
import {
    getSetting,
    setSettingBatch
} from 'runtime/runtime_settings.js';
import { createFontString } from 'util/font_util.js';

export const DIAGNOSTIC_TEST_TYPES = Object.freeze({
    DISPLAY: 'display',
    INPUT: 'input'
});

const DIAGNOSTIC_TEST_COPY = Object.freeze({
    [DIAGNOSTIC_TEST_TYPES.DISPLAY]: 'Inspect the browser viewport and adjust the in-session render scale.',
    [DIAGNOSTIC_TEST_TYPES.INPUT]: 'Press keys or mouse buttons to watch the raw input state update.'
});

const DIAGNOSTIC_FONT_SPECS = Object.freeze({
    BODY: { sizeUIWW: 1.0, min: 13, max: 17, family: 'Pretendard Variable', weight: 500 },
    LABEL: { sizeUIWW: 0.94, min: 12, max: 16, family: 'Pretendard Variable', weight: 720 },
    SECTION: { sizeUIWW: 0.82, min: 11, max: 14, family: 'Pretendard Variable', weight: 760 },
    KEY: { sizeUIWW: 0.76, min: 9, max: 13, family: 'Pretendard Variable', weight: 760 },
    KEY_SMALL: { sizeUIWW: 0.62, min: 8, max: 11, family: 'Pretendard Variable', weight: 760 },
    MONO: { sizeUIWW: 0.86, min: 11, max: 15, family: 'Consolas', weight: 500 },
    MONO_SMALL: { sizeUIWW: 0.74, min: 10, max: 13, family: 'Consolas', weight: 500 }
});

const DIAGNOSTIC_SIZE = Object.freeze({
    [DIAGNOSTIC_TEST_TYPES.DISPLAY]: { widthRatio: 0.62, heightRatio: 0.54 },
    [DIAGNOSTIC_TEST_TYPES.INPUT]: { widthRatio: 0.88, heightRatio: 0.76 }
});

const KEYBOARD_MAIN_LAYOUT = Object.freeze([
    [
        { code: 'Escape', label: 'Esc', w: 1.15 },
        { gap: 0.7 },
        { code: 'F1', label: 'F1' },
        { code: 'F2', label: 'F2' },
        { code: 'F3', label: 'F3' },
        { code: 'F4', label: 'F4' },
        { gap: 0.35 },
        { code: 'F5', label: 'F5' },
        { code: 'F6', label: 'F6' },
        { code: 'F7', label: 'F7' },
        { code: 'F8', label: 'F8' },
        { gap: 0.35 },
        { code: 'F9', label: 'F9' },
        { code: 'F10', label: 'F10' },
        { code: 'F11', label: 'F11' },
        { code: 'F12', label: 'F12' }
    ],
    [
        { code: 'Backquote', label: '`' },
        { code: 'Digit1', label: '1' },
        { code: 'Digit2', label: '2' },
        { code: 'Digit3', label: '3' },
        { code: 'Digit4', label: '4' },
        { code: 'Digit5', label: '5' },
        { code: 'Digit6', label: '6' },
        { code: 'Digit7', label: '7' },
        { code: 'Digit8', label: '8' },
        { code: 'Digit9', label: '9' },
        { code: 'Digit0', label: '0' },
        { code: 'Minus', label: '-' },
        { code: 'Equal', label: '=' },
        { code: 'Backspace', label: 'Backspace', w: 2 }
    ],
    [
        { code: 'Tab', label: 'Tab', w: 1.5 },
        { code: 'KeyQ', label: 'Q' },
        { code: 'KeyW', label: 'W' },
        { code: 'KeyE', label: 'E' },
        { code: 'KeyR', label: 'R' },
        { code: 'KeyT', label: 'T' },
        { code: 'KeyY', label: 'Y' },
        { code: 'KeyU', label: 'U' },
        { code: 'KeyI', label: 'I' },
        { code: 'KeyO', label: 'O' },
        { code: 'KeyP', label: 'P' },
        { code: 'BracketLeft', label: '[' },
        { code: 'BracketRight', label: ']' },
        { code: 'Backslash', label: '\\', w: 1.5 }
    ],
    [
        { code: 'CapsLock', label: 'Caps', w: 1.8 },
        { code: 'KeyA', label: 'A' },
        { code: 'KeyS', label: 'S' },
        { code: 'KeyD', label: 'D' },
        { code: 'KeyF', label: 'F' },
        { code: 'KeyG', label: 'G' },
        { code: 'KeyH', label: 'H' },
        { code: 'KeyJ', label: 'J' },
        { code: 'KeyK', label: 'K' },
        { code: 'KeyL', label: 'L' },
        { code: 'Semicolon', label: ';' },
        { code: 'Quote', label: '\'' },
        { code: 'Enter', label: 'Enter', w: 2.2 }
    ],
    [
        { code: 'ShiftLeft', label: 'Shift', w: 2.3 },
        { code: 'KeyZ', label: 'Z' },
        { code: 'KeyX', label: 'X' },
        { code: 'KeyC', label: 'C' },
        { code: 'KeyV', label: 'V' },
        { code: 'KeyB', label: 'B' },
        { code: 'KeyN', label: 'N' },
        { code: 'KeyM', label: 'M' },
        { code: 'Comma', label: ',' },
        { code: 'Period', label: '.' },
        { code: 'Slash', label: '/' },
        { code: 'ShiftRight', label: 'Shift', w: 2.7 }
    ],
    [
        { code: 'ControlLeft', label: 'Ctrl', w: 1.45 },
        { code: 'MetaLeft', label: 'Win', w: 1.35 },
        { code: 'AltLeft', label: 'Alt', w: 1.35 },
        { code: 'Space', label: 'Space', w: 6.35 },
        { code: 'AltRight', label: 'Alt', w: 1.35 },
        { code: 'MetaRight', label: 'Win', w: 1.35 },
        { code: 'ContextMenu', label: 'Menu', w: 1.35 },
        { code: 'ControlRight', label: 'Ctrl', w: 1.45 }
    ]
]);

const KEYBOARD_NAV_LAYOUT = Object.freeze([
    [
        { code: 'PrintScreen', label: 'Prt' },
        { code: 'ScrollLock', label: 'Scr' },
        { code: 'Pause', label: 'Pause' }
    ],
    [
        { code: 'Insert', label: 'Ins' },
        { code: 'Home', label: 'Home' },
        { code: 'PageUp', label: 'PgUp' }
    ],
    [
        { code: 'Delete', label: 'Del' },
        { code: 'End', label: 'End' },
        { code: 'PageDown', label: 'PgDn' }
    ],
    [
        { gap: 1 },
        { code: 'ArrowUp', label: 'Up' },
        { gap: 1 }
    ],
    [
        { code: 'ArrowLeft', label: 'Left' },
        { code: 'ArrowDown', label: 'Down' },
        { code: 'ArrowRight', label: 'Right' }
    ]
]);

const KEYBOARD_NUMPAD_LAYOUT = Object.freeze([
    [
        { code: 'NumLock', label: 'Num' },
        { code: 'NumpadDivide', label: '/' },
        { code: 'NumpadMultiply', label: '*' },
        { code: 'NumpadSubtract', label: '-' }
    ],
    [
        { code: 'Numpad7', label: '7' },
        { code: 'Numpad8', label: '8' },
        { code: 'Numpad9', label: '9' },
        { code: 'NumpadAdd', label: '+' }
    ],
    [
        { code: 'Numpad4', label: '4' },
        { code: 'Numpad5', label: '5' },
        { code: 'Numpad6', label: '6' },
        { code: 'NumpadEnter', label: 'Ent' }
    ],
    [
        { code: 'Numpad1', label: '1' },
        { code: 'Numpad2', label: '2' },
        { code: 'Numpad3', label: '3' },
        { code: 'NumpadDecimal', label: '.' }
    ],
    [
        { code: 'Numpad0', label: '0', w: 2 },
        { code: 'NumpadComma', label: ',' },
        { code: 'NumpadEqual', label: '=' }
    ]
]);

function truncateText(text, maxLength) {
    const value = String(text ?? '');
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function clampNumber(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return min;
    }
    return Math.min(Math.max(numeric, min), max);
}

function createResponsiveFont(spec, uiww) {
    const sizePx = clampNumber(uiww * (spec.sizeUIWW / 100), spec.min, spec.max);
    return createFontString({
        sizePx,
        family: spec.family,
        weight: spec.weight
    });
}

function fitTextToWidth(text, font, maxWidth) {
    const value = String(text ?? '');
    if (!Number.isFinite(maxWidth) || maxWidth <= 0 || measureText(value, font) <= maxWidth) {
        return value;
    }

    const ellipsis = '...';
    if (measureText(ellipsis, font) > maxWidth) {
        return '';
    }

    let low = 0;
    let high = value.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const candidate = `${value.slice(0, mid)}${ellipsis}`;
        if (measureText(candidate, font) <= maxWidth) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    return `${value.slice(0, low)}${ellipsis}`;
}

function isMouseButtonActive(buttonName) {
    return isMousePressing(buttonName)
        || hasMouseState(buttonName, 'clicked', { includeConsumed: true });
}

/**
 * @class DiagnosticTestOverlay
 * @description 엔진 진단용 디스플레이/입력 테스트 overlay입니다.
 */
export class DiagnosticTestOverlay extends BaseOverlay {
    /**
     * @param {'display'|'input'} testType - 테스트 타입입니다.
     * @param {object} systemHandler - 런타임 설정 반영에 사용할 SystemHandler입니다.
     */
    constructor(testType, systemHandler) {
        super({
            layer: 25,
            dim: 0.34,
            transparent: true,
            glOverlay: true,
            blurUpdateMode: 'always'
        });

        this.testType = Object.values(DIAGNOSTIC_TEST_TYPES).includes(testType)
            ? testType
            : DIAGNOSTIC_TEST_TYPES.DISPLAY;
        this.systemHandler = systemHandler || null;
        this.displayTestStatus = 'Ready';
        this.components = {};
        this.fonts = {};
    }

    /**
     * @override
     */
    _onResize() {
        const size = DIAGNOSTIC_SIZE[this.testType] || DIAGNOSTIC_SIZE[DIAGNOSTIC_TEST_TYPES.DISPLAY];
        this.width = Math.min(this.UIWW * size.widthRatio, this.UIWW * 0.94);
        this.height = Math.min(this.WH * size.heightRatio, this.WH * 0.88);
        this.fonts = Object.fromEntries(
            Object.entries(DIAGNOSTIC_FONT_SPECS).map(([key, spec]) => [key, createResponsiveFont(spec, this.UIWW)])
        );
    }

    /**
     * @override
     */
    _getPanelDefinitions() {
        return [{
            id: 'root',
            radius: { unit: 'WH', value: 1.55 },
            blur: { unit: 'WW', value: 1.7 },
            shadowBlur: { unit: 'WW', value: 1.4 },
            shadowColor: 'rgba(0,0,0,0.32)',
            fill: ColorSchemes.Overlay.Panel.GlassBackground,
            stroke: ColorSchemes.Overlay.Panel.GlassBorder,
            tintColor: ColorSchemes.Overlay.Panel.GlassTint,
            tintStrength: ColorSchemes.Overlay.Panel.GlassTintStrength,
            edgeColor: ColorSchemes.Overlay.Panel.GlassEdge,
            edgeStrength: ColorSchemes.Overlay.Panel.GlassEdgeStrength,
            refractionStrength: 0.018
        }];
    }

    /**
     * @override
     */
    _generateLayout() {
        this._releaseElements();
        const handler = new LayoutHandler(
            this.getPanelLayoutParent('root'),
            this.createPanelPositioningHandler('root')
        ).paddingX('WW', 1.5)
            .space('WH', 2.2)
            .item('text')
            .stylePreset('h2')
            .text(this.#getTitle())
            .fill(ColorSchemes.Overlay.Text.Title)
            .space('WH', 1.1)
            .item('text')
            .stylePreset('h4')
            .text(this.#getDescription())
            .fill(ColorSchemes.Overlay.Text.Item);

        this.#buildBottomControls(handler);

        const buildResult = handler.build();
        this.dynamicItems = buildResult.dynamicItems;
        this.staticItems = buildResult.staticItems;
        this.components = buildResult.components;
    }

    /**
     * @override
     */
    _drawOverlayDecorations() {
        if (this.testType === DIAGNOSTIC_TEST_TYPES.DISPLAY) {
            this.#drawDisplayTestContent();
        } else if (this.testType === DIAGNOSTIC_TEST_TYPES.INPUT) {
            this.#drawInputTestContent();
        }
    }

    #getTitle() {
        if (this.testType === DIAGNOSTIC_TEST_TYPES.DISPLAY) return 'Browser / Render Test';
        if (this.testType === DIAGNOSTIC_TEST_TYPES.INPUT) return 'Input Test';
        return 'Diagnostic Test';
    }

    #getDescription() {
        return DIAGNOSTIC_TEST_COPY[this.testType] || '';
    }

    #uww(value) {
        return this.UIWW * (value / 100);
    }

    #uwh(value) {
        return this.WH * (value / 100);
    }

    #buildBottomControls(handler) {
        if (this.testType === DIAGNOSTIC_TEST_TYPES.DISPLAY) {
            handler.bottomSpace('WH', 2.1)
                .bottomGroup('display-actions-b').justifyContent('right', 'WW', 0.55).align('right')
                .item('button').stylePreset('overlay_interact_button').width('content').buttonText('75%').buttonColor(ColorSchemes.Overlay.Button.Confirm).icon('check').onClick(() => {
                    void this.#applyRenderScale(75);
                })
                .item('button').stylePreset('overlay_interact_button').width('content').buttonText('100%').buttonColor(ColorSchemes.Overlay.Button.Confirm).icon('check').onClick(() => {
                    void this.#applyRenderScale(100);
                })
                .item('button').stylePreset('overlay_interact_button').width('content').buttonText('Close').buttonColor(ColorSchemes.Overlay.Button.Cancel).icon('deny').onClick(this.close.bind(this))
                .endGroup();
            return;
        }

        handler.bottomSpace('WH', 2.1)
            .bottomGroup('input-actions').justifyContent('right', 'WW', 1).align('right')
            .item('button').stylePreset('overlay_interact_button').width('content').buttonText('Close').buttonColor(ColorSchemes.Overlay.Button.Cancel).icon('deny').onClick(this.close.bind(this))
            .endGroup();
    }

    #getContentRect() {
        const panel = this.getPanelRegion('root') || { x: this.scaledX, y: this.scaledY, w: this.scaledW, h: this.scaledH };
        const insetX = Math.max(this.#uww(1.5), panel.w * 0.055);
        const topOffset = this.testType === DIAGNOSTIC_TEST_TYPES.INPUT
            ? this.#uwh(9.2)
            : this.#uwh(13.8);
        const bottomReserve = this.testType === DIAGNOSTIC_TEST_TYPES.DISPLAY
            ? this.#uwh(14.8)
            : this.#uwh(11.2);
        return {
            x: panel.x + insetX,
            y: panel.y + topOffset,
            w: panel.w - (insetX * 2),
            h: panel.h - topOffset - bottomReserve
        };
    }

    #drawDisplayTestContent() {
        const rect = this.#getContentRect();
        const screenHandler = getDisplaySystem()?.screenHandler;
        const metrics = [
            ['Runtime storage', 'None (session only)'],
            ['Render scale', `${getSetting('renderScale')}%`],
            ['Aspect policy', '16:9 letterbox'],
            ['Internal render', `${getWW()} x ${getWH()}`],
            ['Base render', `${getBaseWW()} x ${getBaseWH()}`],
            ['CSS viewport', `${Math.round(screenHandler?.cssWidth || 0)} x ${Math.round(screenHandler?.cssHeight || 0)}`],
            ['Viewport mode', screenHandler?.viewportMode || 'unknown'],
            ['Browser inner', `${window.innerWidth} x ${window.innerHeight}`],
            ['Device pixel ratio', `${Number(window.devicePixelRatio || 1).toFixed(2)}`]
        ];

        const columnGap = this.#uww(2.4);
        const columnW = (rect.w - columnGap) / 2;
        const labelW = Math.min(this.#uww(8.0), columnW * 0.48);
        this.#drawSectionLabel(rect.x, rect.y, 'WINDOW');
        for (let index = 0; index < 5; index++) {
            this.#drawInfoLine(rect.x, rect.y + this.#uwh(3.6) + (index * this.#uwh(3.15)), metrics[index][0], metrics[index][1], labelW, columnW - labelW);
        }

        const secondX = rect.x + columnW + columnGap;
        this.#drawSectionLabel(secondX, rect.y, 'VIEWPORT');
        for (let index = 5; index < metrics.length; index++) {
            this.#drawInfoLine(secondX, rect.y + this.#uwh(3.6) + ((index - 5) * this.#uwh(3.15)), metrics[index][0], metrics[index][1], labelW, columnW - labelW);
        }

        this.#drawDivider(rect.x, rect.y + Math.min(this.#uwh(20.0), rect.h - this.#uwh(4.8)), rect.w);
        render(this.layer, {
            shape: 'text',
            x: rect.x,
            y: rect.y + Math.min(this.#uwh(23.4), rect.h - this.#uwh(2.2)),
            text: fitTextToWidth(`Status: ${this.displayTestStatus}`, this.fonts.MONO, rect.w),
            font: this.fonts.MONO,
            fill: ColorSchemes.Overlay.Control.Accent || '#82d7ff',
            baseline: 'middle'
        });
    }

    #drawInputTestContent() {
        const rect = this.#getContentRect();
        const mousePanelReserve = this.#uwh(9.6);
        const unit = Math.min(rect.w / 25.8, Math.max(1, (rect.h - mousePanelReserve) / 6.9));
        const keyH = unit * 0.84;
        const rowGap = unit * 0.14;
        const mainX = rect.x + Math.max(0, (rect.w - (unit * 25.1)) / 2);
        const navX = mainX + (unit * 16.4);
        const numX = navX + (unit * 3.75);

        for (let rowIndex = 0; rowIndex < KEYBOARD_MAIN_LAYOUT.length; rowIndex++) {
            this.#drawKeyboardRow(KEYBOARD_MAIN_LAYOUT[rowIndex], mainX, rect.y + (rowIndex * (keyH + rowGap)), unit, keyH, rowGap);
        }
        for (let rowIndex = 0; rowIndex < KEYBOARD_NAV_LAYOUT.length; rowIndex++) {
            const adjustedY = rowIndex >= 3
                ? rect.y + ((rowIndex + 1) * (keyH + rowGap))
                : rect.y + (rowIndex * (keyH + rowGap));
            this.#drawKeyboardRow(KEYBOARD_NAV_LAYOUT[rowIndex], navX, adjustedY, unit, keyH, rowGap);
        }
        for (let rowIndex = 0; rowIndex < KEYBOARD_NUMPAD_LAYOUT.length; rowIndex++) {
            this.#drawKeyboardRow(KEYBOARD_NUMPAD_LAYOUT[rowIndex], numX, rect.y + (rowIndex * (keyH + rowGap)), unit, keyH, rowGap);
        }

        this.#drawMouseInputPanel(rect, rect.y + ((KEYBOARD_MAIN_LAYOUT.length + 0.7) * (keyH + rowGap)));
    }

    #drawKeyboardRow(row, x, y, unit, keyH, gap) {
        let cursorX = x;
        for (const key of row) {
            if (key.gap) {
                cursorX += unit * key.gap;
                continue;
            }

            const keyW = (unit * (key.w || 1)) - gap;
            this.#drawKeyboardKey(key.code, key.label, cursorX, y, keyW, keyH);
            cursorX += keyW + gap;
        }
    }

    #drawKeyboardKey(code, label, x, y, w, h) {
        const pressed = getKeyboardCodeInput(code);
        render(this.layer, {
            shape: 'roundRect',
            x,
            y,
            w,
            h,
            radius: Math.max(2, h * 0.16),
            fill: pressed ? 'rgba(73,156,255,0.90)' : 'rgba(255,255,255,0.035)',
            stroke: pressed ? 'rgba(168,218,255,0.95)' : 'rgba(255,255,255,0.16)',
            lineWidth: pressed ? 1.8 : 1
        });
        render(this.layer, {
            shape: 'text',
            x: x + (w / 2),
            y: y + (h / 2),
            text: label,
            font: label.length > 4 || w < this.#uww(2.2) ? this.fonts.KEY_SMALL : this.fonts.KEY,
            fill: pressed ? '#ffffff' : 'rgba(255,255,255,0.78)',
            align: 'center',
            baseline: 'middle'
        });
    }

    #drawMouseInputPanel(rect, y) {
        const mousePos = getMouseInput('pos') || { x: 0, y: 0 };
        const wheel = getMouseInput('wheel') || {};
        const keyboardSnapshot = getKeyboardSnapshot();
        const lastKey = keyboardSnapshot.lastEvent
            ? `${keyboardSnapshot.lastEvent.code || keyboardSnapshot.lastEvent.key} ${keyboardSnapshot.lastEvent.pressed ? 'down' : 'up'}`
            : 'none';

        this.#drawDivider(rect.x, y, rect.w);
        this.#drawSectionLabel(rect.x, y + this.#uwh(3.2), 'MOUSE');
        const textInset = this.#uww(1.1);
        render(this.layer, {
            shape: 'text',
            x: rect.x + textInset,
            y: y + this.#uwh(6.2),
            text: fitTextToWidth(
                `Mouse ${Math.round(mousePos.x)}, ${Math.round(mousePos.y)}   Wheel dY ${Math.round(wheel.deltaY || 0)}   Last key ${lastKey}`,
                this.fonts.MONO,
                rect.w - (textInset * 2)
            ),
            font: this.fonts.MONO,
            fill: ColorSchemes.Overlay.Text.Item,
            baseline: 'middle'
        });

        const chipGap = this.#uww(0.8);
        const chipX = rect.x + textInset;
        const chipY = y + this.#uwh(9.2);
        const chipW = (rect.w - (textInset * 2) - (chipGap * 3)) / 4;
        const chipH = this.#uwh(3.3);
        this.#drawInputChip('Left', isMouseButtonActive('left'), chipX, chipY, chipW, chipH);
        this.#drawInputChip('Middle', isMouseButtonActive('middle'), chipX + ((chipW + chipGap) * 1), chipY, chipW, chipH);
        this.#drawInputChip('Right', isMouseButtonActive('right'), chipX + ((chipW + chipGap) * 2), chipY, chipW, chipH);
        this.#drawInputChip('Wheel', wheel.active === true, chipX + ((chipW + chipGap) * 3), chipY, chipW, chipH);
    }

    #drawInputChip(label, active, x, y, w, h) {
        render(this.layer, {
            shape: 'roundRect',
            x,
            y,
            w,
            h,
            radius: Math.max(3, h * 0.16),
            fill: active ? 'rgba(73,156,255,0.90)' : 'rgba(255,255,255,0.035)',
            stroke: active ? 'rgba(168,218,255,0.95)' : 'rgba(255,255,255,0.16)',
            lineWidth: 1
        });
        render(this.layer, {
            shape: 'text',
            x: x + (w / 2),
            y: y + (h / 2),
            text: label,
            font: this.fonts.KEY,
            fill: '#ffffff',
            align: 'center',
            baseline: 'middle'
        });
    }

    #drawSectionLabel(x, y, text) {
        render(this.layer, {
            shape: 'text',
            x,
            y,
            text,
            font: this.fonts.SECTION,
            fill: ColorSchemes.Overlay.Text.Sub || 'rgba(255,255,255,0.58)',
            baseline: 'middle'
        });
    }

    #drawDivider(x, y, width) {
        render(this.layer, {
            shape: 'line',
            x1: x,
            y1: y,
            x2: x + width,
            y2: y,
            stroke: ColorSchemes.Overlay.Panel.Divider || 'rgba(255,255,255,0.08)',
            lineWidth: 1
        });
    }

    #drawInfoLine(x, y, label, value, labelW = 0, maxWidth = Infinity) {
        const resolvedLabelW = labelW > 0 ? labelW : this.#uww(8);
        render(this.layer, {
            shape: 'text',
            x,
            y,
            text: label,
            font: this.fonts.LABEL,
            fill: ColorSchemes.Overlay.Text.Sub || 'rgba(255,255,255,0.58)',
            baseline: 'middle'
        });
        render(this.layer, {
            shape: 'text',
            x: x + resolvedLabelW,
            y,
            text: fitTextToWidth(String(value ?? ''), this.fonts.MONO, Math.max(0, maxWidth)),
            font: this.fonts.MONO,
            fill: ColorSchemes.Overlay.Text.Item,
            baseline: 'middle'
        });
    }

    #drawBox(x, y, w, h) {
        render(this.layer, {
            shape: 'roundRect',
            x,
            y,
            w,
            h,
            radius: Math.max(4, this.#uwh(1.0)),
            fill: 'rgba(255,255,255,0.055)',
            stroke: 'rgba(255,255,255,0.13)',
            lineWidth: 1
        });
    }

    async #applyRenderScale(renderScale) {
        this.displayTestStatus = `Applying render scale ${renderScale}%...`;
        try {
            await setSettingBatch({ renderScale });
            await this.systemHandler?.applyRuntimeSettings?.({ renderScale });
            this.systemHandler?.resize?.();
            this.displayTestStatus = `Render scale ${renderScale}%`;
        } catch (error) {
            console.error(error);
            this.displayTestStatus = error?.message || String(error);
        }
    }

}
