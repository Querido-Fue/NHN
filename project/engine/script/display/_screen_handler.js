import { getData } from 'data/data_handler.js';
import { getSetting } from 'runtime/runtime_settings.js';
import { clampNumber } from 'util/number_util.js';

const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');

/**
 * 현재 브라우저 뷰포트에 맞춰 Canvas 렌더 타깃과 16:9 UI 안전 영역을 계산합니다.
 * 창 크기와 전체화면 상태는 브라우저가 소유하며 별도로 저장하지 않습니다.
 */
export class ScreenHandler {
    constructor() {
        this.width = 1;
        this.height = 1;
        this.baseWidth = 1;
        this.baseHeight = 1;
        this.objectHeight = 1;
        this.objectOffsetY = 0;
        this.uiWidth = 1;
        this.uiOffsetX = 0;
        this.viewportMode = 'native16by9';
        this.cssWidth = 1;
        this.cssHeight = 1;
        this.cssLeft = 0;
        this.cssTop = 0;
        this.scaleRatio = 1;
    }

    async init() {
        this.#recalculateRenderTarget();
        this.resize();
    }

    resize() {
        const changed = this.#recalculateRenderTarget();
        const viewportWidth = Math.max(1, window.innerWidth);
        const viewportHeight = Math.max(1, window.innerHeight);
        const renderRatio = this.width / this.height;
        const viewportRatio = viewportWidth / viewportHeight;
        if (viewportRatio > renderRatio) {
            this.cssHeight = viewportHeight;
            this.cssWidth = this.cssHeight * renderRatio;
            this.cssTop = 0;
            this.cssLeft = (viewportWidth - this.cssWidth) / 2;
        } else if (viewportRatio < renderRatio) {
            this.cssWidth = viewportWidth;
            this.cssHeight = this.cssWidth / renderRatio;
            this.cssLeft = 0;
            this.cssTop = (viewportHeight - this.cssHeight) / 2;
        } else {
            this.cssWidth = viewportWidth;
            this.cssHeight = viewportHeight;
            this.cssLeft = 0;
            this.cssTop = 0;
        }
        this.scaleRatio = this.width / Math.max(1, this.cssWidth);
        return changed;
    }

    async applyWindowMode() {
        this.resize();
    }

    get WW() { return this.width; }
    get WH() { return this.height; }
    get ObjectWH() { return this.objectHeight; }
    get ObjectOffsetY() { return this.objectOffsetY; }
    get UIWW() { return this.uiWidth; }
    get UIOffsetX() { return this.uiOffsetX; }

    #recalculateRenderTarget() {
        const ratio = GLOBAL_CONSTANTS.ASPECT_RATIO.RATIO;
        const renderScale = clampNumber(Number(getSetting('renderScale')) || 100, 75, 100) / 100;
        const deviceScale = Math.max(1, Number(window.devicePixelRatio) || 1);
        const sourceWidth = Math.max(1, Math.floor(window.innerWidth * deviceScale));
        const sourceHeight = Math.max(1, Math.floor(window.innerHeight * deviceScale));
        const sourceRatio = sourceWidth / sourceHeight;
        let baseWidth = sourceWidth;
        let baseHeight = sourceHeight;
        let viewportMode = 'native16by9';
        if (sourceRatio < ratio) {
            baseHeight = baseWidth / ratio;
            viewportMode = 'letterboxTall';
        } else if (sourceRatio > ratio) {
            baseWidth = baseHeight * ratio;
            viewportMode = 'letterboxWide';
        }
        const nextBaseWidth = Math.max(1, Math.floor(baseWidth));
        const nextBaseHeight = Math.max(1, Math.floor(baseHeight));
        const nextWidth = Math.max(1, Math.floor(nextBaseWidth * renderScale));
        const nextHeight = Math.max(1, Math.floor(nextBaseHeight * renderScale));
        const nextUiWidth = Math.floor(clampNumber(nextWidth, 1, nextHeight * ratio));
        const nextUiOffsetX = (nextWidth - nextUiWidth) / 2;
        const changed = this.baseWidth !== nextBaseWidth
            || this.baseHeight !== nextBaseHeight
            || this.width !== nextWidth
            || this.height !== nextHeight
            || this.uiWidth !== nextUiWidth
            || this.uiOffsetX !== nextUiOffsetX
            || this.viewportMode !== viewportMode;
        this.baseWidth = nextBaseWidth;
        this.baseHeight = nextBaseHeight;
        this.width = nextWidth;
        this.height = nextHeight;
        this.objectHeight = nextHeight;
        this.objectOffsetY = 0;
        this.uiWidth = nextUiWidth;
        this.uiOffsetX = nextUiOffsetX;
        this.viewportMode = viewportMode;
        return changed;
    }
}
