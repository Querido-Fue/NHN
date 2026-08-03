import { BaseScene } from 'scene/_base_scene.js';
import { getData } from 'data/data_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { getWH, getUIOffsetX, getUIWW, getWW, measureText, render, renderGL } from 'display/display_system.js';
import { getDelta } from 'engine/time_handler.js';
import { consumeMouseState, hasMouseState } from 'input/input_system.js';
import { createFontStringFromPreset, wrapTextByCharacters } from 'util/font_util.js';
import { areSceneImageRecordsSettled, waitForSceneReadyCondition } from 'scene/_scene_transition_ready.js';

const TYCOON_CONSTANTS = getData('TYCOON_SCENE_CONSTANTS');
const TEXT_CONSTANTS = getData('TEXT_CONSTANTS');
const TYCOON_SCENE_PHASES = Object.freeze({
    INTRO: 'intro',
    EXTERIOR_TRANSITION: 'exteriorTransition',
    INTERIOR: 'interior'
});

/**
 * 이미지가 화면을 꽉 채우도록 source crop 영역을 계산합니다.
 * @param {HTMLImageElement} image - 원본 이미지입니다.
 * @param {number} width - 대상 너비입니다.
 * @param {number} height - 대상 높이입니다.
 * @returns {{sx:number, sy:number, sw:number, sh:number}} source crop 영역입니다.
 */
function calculateCoverSourceRect(image, width, height) {
    const imageRatio = image.width / Math.max(1, image.height);
    const targetRatio = width / Math.max(1, height);
    let sx = 0;
    let sy = 0;
    let sw = image.width;
    let sh = image.height;

    if (imageRatio > targetRatio) {
        sw = image.height * targetRatio;
        sx = (image.width - sw) * 0.5;
    } else {
        sh = image.width / targetRatio;
        sy = (image.height - sh) * 0.5;
    }

    return { sx, sy, sw, sh };
}

/**
 * @class TycoonScene
 * @description 타이쿤 인트로, 편의점 외관 확대 전환, 기본 인테리어를 표시합니다.
 */
export class TycoonScene extends BaseScene {
    /**
     * @param {object} sceneSystem - 씬 시스템 인스턴스입니다.
     */
    constructor(sceneSystem) {
        super(sceneSystem);
        this.phase = TYCOON_SCENE_PHASES.INTRO;
        this.currentSlideIndex = 0;
        this.exteriorTransitionElapsed = 0;
        this.images = new Map();
        this.ignoreInitialClick = true;
        this.isDestroyed = false;
        this.#syncViewport();
        this.#loadSceneImages();
    }

    /**
     * @override
     */
    update() {
        if (this.#consumeInitialClickGuard()) {
            return;
        }

        if (this.phase === TYCOON_SCENE_PHASES.INTRO && consumeMouseState('left')) {
            this.#advanceIntro();
            return;
        }

        if (this.phase === TYCOON_SCENE_PHASES.EXTERIOR_TRANSITION) {
            this.#updateExteriorTransition(getDelta());
        }
    }

    /**
     * @override
     */
    draw() {
        this.#drawBackground();

        if (this.phase === TYCOON_SCENE_PHASES.INTRO) {
            this.#drawCurrentSlideImage();
            this.#drawBottomTextBand();
            return;
        }

        if (this.phase === TYCOON_SCENE_PHASES.EXTERIOR_TRANSITION) {
            this.#drawExteriorTransition();
            return;
        }

        this.#drawInteriorScene();
    }

    /**
     * @override
     */
    whenReadyForTransition() {
        return waitForSceneReadyCondition(() => {
            return this.isDestroyed || areSceneImageRecordsSettled(this.images.values());
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
        for (const record of this.images.values()) {
            record.image.onload = null;
            record.image.onerror = null;
        }
        this.images.clear();
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
    }

    /**
     * 타이쿤 씬에 사용할 이미지를 미리 로드합니다.
     * @private
     */
    #loadSceneImages() {
        for (const slide of TYCOON_CONSTANTS.INTRO.SLIDES) {
            this.#getImage(slide.image);
        }

        this.#getImage(TYCOON_CONSTANTS.SPRITE_PATH);
    }

    /**
     * 이미지 경로에 대응하는 캐시 레코드를 반환합니다.
     * @param {string} path - 이미지 경로입니다.
     * @returns {{image: HTMLImageElement, ready: boolean, failed: boolean}} 이미지 캐시 레코드입니다.
     * @private
     */
    #getImage(path) {
        if (this.images.has(path)) {
            return this.images.get(path);
        }

        const record = { image: new Image(), ready: false, failed: false };

        record.image.onload = () => {
            record.ready = true;
        };
        record.image.onerror = () => {
            record.failed = true;
        };
        record.image.src = path;
        this.images.set(path, record);
        return record;
    }

    /**
     * 씬 진입을 발생시킨 마우스 클릭이 인트로 진행으로 전달되지 않도록 소비합니다.
     * @returns {boolean} 이번 프레임을 가드 처리했는지 여부입니다.
     * @private
     */
    #consumeInitialClickGuard() {
        if (!this.ignoreInitialClick) {
            return false;
        }

        const isPressing = hasMouseState('left', 'click') || hasMouseState('left', 'clicking');
        const consumedRelease = consumeMouseState('left');

        if (!isPressing && !consumedRelease) {
            this.ignoreInitialClick = false;
        }

        return true;
    }

    /**
     * 다음 인트로 슬라이드로 진행하고 마지막 이후에는 외관 확대 전환을 시작합니다.
     * @private
     */
    #advanceIntro() {
        const lastSlideIndex = TYCOON_CONSTANTS.INTRO.SLIDES.length - 1;

        if (this.currentSlideIndex < lastSlideIndex) {
            this.currentSlideIndex += 1;
            return;
        }

        this.phase = TYCOON_SCENE_PHASES.EXTERIOR_TRANSITION;
        this.exteriorTransitionElapsed = 0;
    }

    /**
     * 외관 확대 전환 시간을 갱신하고 완료되면 내부 씬으로 넘어갑니다.
     * @param {number} deltaTime - 초 단위 가변 프레임 시간입니다.
     * @private
     */
    #updateExteriorTransition(deltaTime) {
        const duration = TYCOON_CONSTANTS.EXTERIOR_TRANSITION.DURATION_SECONDS;

        this.exteriorTransitionElapsed += Math.max(0, deltaTime);
        if (this.exteriorTransitionElapsed >= duration) {
            this.phase = TYCOON_SCENE_PHASES.INTERIOR;
            this.exteriorTransitionElapsed = duration;
        }
    }

    /**
     * 전체 배경색을 렌더링합니다.
     * @private
     */
    #drawBackground() {
        renderGL('background', {
            shape: 'rect',
            x: this.WW * 0.5,
            y: this.WH * 0.5,
            w: this.WW,
            h: this.WH,
            fill: ColorSchemes.Background
        });
        render('ui', {
            shape: 'rect',
            x: 0,
            y: 0,
            w: this.WW,
            h: this.WH,
            fill: ColorSchemes.Background
        });
    }

    /**
     * 현재 인트로 이미지를 화면을 덮도록 렌더링합니다.
     * @private
     */
    #drawCurrentSlideImage() {
        const slide = this.#getCurrentSlide();
        const imageRecord = this.#getImage(slide.image);

        if (!imageRecord.ready) {
            return;
        }

        render('ui', {
            shape: 'image',
            image: imageRecord.image,
            ...calculateCoverSourceRect(imageRecord.image, this.WW, this.WH),
            x: 0,
            y: 0,
            w: this.WW,
            h: this.WH,
            smoothing: false
        });
        render('ui', {
            shape: 'rect',
            x: 0,
            y: 0,
            w: this.WW,
            h: this.WH,
            fill: '#000000',
            alpha: TYCOON_CONSTANTS.INTRO.IMAGE_DIM_ALPHA
        });
    }

    /**
     * 하단 스토리 문구와 클릭 안내 문구를 렌더링합니다.
     * @private
     */
    #drawBottomTextBand() {
        const intro = TYCOON_CONSTANTS.INTRO;
        const bandHeight = this.#wh(intro.BOTTOM_DIM_HEIGHT_WH);
        const storyFont = this.#buildFont(TEXT_CONSTANTS.H3);
        const promptFont = this.#buildFont(TEXT_CONSTANTS.H4);
        const storyLines = this.#wrapStoryText(this.#getCurrentSlide().story, storyFont);
        const storyStartY = this.#wh(intro.STORY_BASELINE_WH)
            - ((storyLines.length - 1) * this.#wh(intro.STORY_LINE_GAP_WH) * 0.5);

        render('ui', {
            shape: 'rect',
            x: 0,
            y: this.WH - bandHeight,
            w: this.WW,
            h: bandHeight,
            fill: '#000000',
            alpha: intro.BOTTOM_DIM_ALPHA
        });

        storyLines.forEach((line, index) => {
            this.#drawCenteredText(
                line,
                storyStartY + (index * this.#wh(intro.STORY_LINE_GAP_WH)),
                storyFont,
                '#fffaf0'
            );
        });
        this.#drawCenteredText(
            intro.CLICK_PROMPT,
            this.#wh(intro.PROMPT_BASELINE_WH),
            promptFont,
            'rgba(255,250,240,0.78)'
        );
    }

    /**
     * 편의점 외관이 살짝 확대되며 내부로 전환되는 장면을 렌더링합니다.
     * @private
     */
    #drawExteriorTransition() {
        const transition = TYCOON_CONSTANTS.EXTERIOR_TRANSITION;
        const progress = this.#clamp01(this.exteriorTransitionElapsed / transition.DURATION_SECONDS);
        const easedProgress = this.#easeInOutCubic(progress);
        const scale = transition.START_SCALE
            + ((transition.END_SCALE - transition.START_SCALE) * easedProgress);
        const interiorAlpha = this.#clamp01(
            (progress - transition.INTERIOR_FADE_START) / Math.max(0.001, 1 - transition.INTERIOR_FADE_START)
        );
        const exteriorAlpha = 1 - (interiorAlpha * 0.78);

        this.#drawExteriorScene(scale, exteriorAlpha);

        if (interiorAlpha > 0) {
            this.#drawInteriorScene(interiorAlpha);
        }
    }

    /**
     * 스프라이트 시트의 편의점 외관 crop을 현재 화면 중앙에 렌더링합니다.
     * @param {number} scale - 외관 확대 배율입니다.
     * @param {number} alpha - 외관 투명도입니다.
     * @private
     */
    #drawExteriorScene(scale = 1, alpha = 1) {
        const exterior = TYCOON_CONSTANTS.EXTERIOR_TILEMAP;
        const spriteRecord = this.#getImage(TYCOON_CONSTANTS.SPRITE_PATH);
        const rect = this.#getExteriorTileMapScreenRect(scale);

        render('ui', {
            shape: 'rect',
            x: 0,
            y: 0,
            w: this.WW,
            h: this.WH,
            fill: TYCOON_CONSTANTS.COLORS.EXTERIOR_SKY,
            alpha
        });
        render('ui', {
            shape: 'rect',
            x: 0,
            y: this.#wh(exterior.GROUND_Y_WH),
            w: this.WW,
            h: this.WH - this.#wh(exterior.GROUND_Y_WH),
            fill: TYCOON_CONSTANTS.COLORS.EXTERIOR_GROUND,
            alpha
        });

        if (!spriteRecord.ready) {
            this.#drawExteriorFallback(rect.x, rect.y, rect.w, rect.h, alpha);
            return;
        }

        this.#drawExteriorTileMap(rect, alpha);
    }

    /**
     * 스프라이트 이미지 로드 전 외관 영역의 대체 박스를 렌더링합니다.
     * @private
     */
    #drawExteriorFallback(x, y, width, height, alpha) {
        render('ui', {
            shape: 'rect',
            x,
            y,
            w: width,
            h: height,
            fill: ColorSchemes.Overlay.Panel.Background,
            stroke: ColorSchemes.Overlay.Panel.Border,
            lineWidth: Math.max(2, this.#wh(0.2)),
            alpha
        });
    }

    /**
     * 편의점 외관 타일맵을 16px 셀 단위로 잘라 렌더링합니다.
     * @param {{x:number, y:number, scale:number, tileSize:number}} rect - 외관 화면 영역입니다.
     * @param {number} alpha - 투명도입니다.
     * @private
     */
    #drawExteriorTileMap(rect, alpha) {
        const exterior = TYCOON_CONSTANTS.EXTERIOR_TILEMAP;
        const spriteRecord = this.#getImage(TYCOON_CONSTANTS.SPRITE_PATH);
        if (!spriteRecord.ready) {
            return;
        }

        for (let row = 0; row < exterior.ROWS; row += 1) {
            for (let column = 0; column < exterior.COLUMNS; column += 1) {
                this.#drawSpriteTile(spriteRecord.image, {
                    sx: exterior.SOURCE_X + (column * exterior.TILE_SIZE),
                    sy: exterior.SOURCE_Y + (row * exterior.TILE_SIZE),
                    sw: exterior.TILE_SIZE,
                    sh: exterior.TILE_SIZE
                }, {
                    x: rect.x + (column * rect.tileSize),
                    y: rect.y + (row * rect.tileSize),
                    w: rect.tileSize,
                    h: rect.tileSize
                }, alpha);
            }
        }
    }

    /**
     * 빈 편의점 내부 기본 배치를 렌더링합니다.
     * @param {number} [alpha=1] - 내부 씬 투명도입니다.
     * @private
     */
    #drawInteriorScene(alpha = 1) {
        const interior = TYCOON_CONSTANTS.INTERIOR;
        const rect = this.#getInteriorScreenRect();
        const wallHeight = interior.WALL_HEIGHT_TILES * interior.TILE_SIZE * rect.scale;
        const floorY = rect.y + wallHeight;
        const shadowOffset = interior.SHADOW_OFFSET_TILES * interior.TILE_SIZE * rect.scale;

        render('ui', {
            shape: 'rect',
            x: rect.x + shadowOffset,
            y: rect.y + shadowOffset,
            w: rect.w,
            h: rect.h,
            fill: TYCOON_CONSTANTS.COLORS.INTERIOR_SHADOW,
            alpha
        });
        render('ui', {
            shape: 'rect',
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            fill: TYCOON_CONSTANTS.COLORS.INTERIOR_FLOOR_A,
            stroke: TYCOON_CONSTANTS.COLORS.INTERIOR_OUTLINE,
            lineWidth: Math.max(2, rect.scale),
            alpha
        });
        render('ui', {
            shape: 'rect',
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: wallHeight,
            fill: TYCOON_CONSTANTS.COLORS.INTERIOR_WALL,
            alpha
        });
        render('ui', {
            shape: 'rect',
            x: rect.x,
            y: floorY,
            w: rect.w,
            h: rect.h - wallHeight,
            fill: TYCOON_CONSTANTS.COLORS.INTERIOR_FLOOR_A,
            alpha
        });

        this.#drawInteriorFloorGrid(rect, alpha);
        this.#drawInteriorDoor(rect, alpha);
        this.#drawInteriorCheckoutCounter(rect, alpha);
    }

    /**
     * 내부 바닥의 12px 타일 그리드를 렌더링합니다.
     * @param {{x:number, y:number, w:number, h:number, scale:number}} rect - 내부 화면 영역입니다.
     * @param {number} alpha - 투명도입니다.
     * @private
     */
    #drawInteriorFloorGrid(rect, alpha) {
        const interior = TYCOON_CONSTANTS.INTERIOR;
        const tileSize = interior.TILE_SIZE * rect.scale;
        const wallTiles = interior.WALL_HEIGHT_TILES;

        for (let row = wallTiles; row < interior.ROWS; row += 1) {
            for (let column = 0; column < interior.COLUMNS; column += 1) {
                if ((row + column) % 2 !== 0) {
                    continue;
                }

                render('ui', {
                    shape: 'rect',
                    x: rect.x + (column * tileSize),
                    y: rect.y + (row * tileSize),
                    w: tileSize,
                    h: tileSize,
                    fill: TYCOON_CONSTANTS.COLORS.INTERIOR_FLOOR_B,
                    alpha: alpha * 0.82
                });
            }
        }

        for (let column = 0; column <= interior.COLUMNS; column += 1) {
            const x = rect.x + (column * tileSize);
            render('ui', {
                shape: 'line',
                x1: x,
                y1: rect.y + (wallTiles * tileSize),
                x2: x,
                y2: rect.y + rect.h,
                stroke: TYCOON_CONSTANTS.COLORS.INTERIOR_GRID,
                lineWidth: Math.max(1, rect.scale * 0.18),
                alpha
            });
        }

        for (let row = wallTiles; row <= interior.ROWS; row += 1) {
            const y = rect.y + (row * tileSize);
            render('ui', {
                shape: 'line',
                x1: rect.x,
                y1: y,
                x2: rect.x + rect.w,
                y2: y,
                stroke: TYCOON_CONSTANTS.COLORS.INTERIOR_GRID,
                lineWidth: Math.max(1, rect.scale * 0.18),
                alpha
            });
        }
    }

    /**
     * 내부의 12x12 문을 렌더링합니다.
     * @param {{x:number, y:number, scale:number}} rect - 내부 화면 영역입니다.
     * @param {number} alpha - 투명도입니다.
     * @private
     */
    #drawInteriorDoor(rect, alpha) {
        const interior = TYCOON_CONSTANTS.INTERIOR;
        const door = interior.DOOR;
        const tileSize = interior.TILE_SIZE;
        const screenRect = this.#interiorWorldRectToScreen(rect, {
            x: door.TILE_X * tileSize,
            y: door.TILE_Y * tileSize,
            w: door.TILE_WIDTH * tileSize,
            h: door.TILE_HEIGHT * tileSize
        });

        if (this.#isSpriteReady()) {
            this.#drawSprite(TYCOON_CONSTANTS.SPRITES.DOOR, screenRect.x, screenRect.y, screenRect.w, screenRect.h, alpha);
            return;
        }

        render('ui', {
            shape: 'rect',
            ...screenRect,
            fill: TYCOON_CONSTANTS.COLORS.INTERIOR_DOOR,
            alpha
        });
    }

    /**
     * 내부의 기본 계산대만 렌더링합니다.
     * @param {{x:number, y:number, scale:number}} rect - 내부 화면 영역입니다.
     * @param {number} alpha - 투명도입니다.
     * @private
     */
    #drawInteriorCheckoutCounter(rect, alpha) {
        const interior = TYCOON_CONSTANTS.INTERIOR;
        const counter = interior.CHECKOUT_COUNTER;
        const tileSize = interior.TILE_SIZE;
        const screenRect = this.#interiorWorldRectToScreen(rect, {
            x: counter.TILE_X * tileSize,
            y: counter.TILE_Y * tileSize,
            w: counter.TILE_WIDTH * tileSize,
            h: counter.TILE_HEIGHT * tileSize
        });

        if (this.#isSpriteReady()) {
            this.#drawSprite(
                TYCOON_CONSTANTS.SPRITES.CHECKOUT_COUNTER,
                screenRect.x,
                screenRect.y,
                screenRect.w,
                screenRect.h,
                alpha
            );
            return;
        }

        render('ui', {
            shape: 'rect',
            ...screenRect,
            fill: TYCOON_CONSTANTS.COLORS.INTERIOR_COUNTER,
            stroke: TYCOON_CONSTANTS.COLORS.INTERIOR_COUNTER_TOP,
            lineWidth: Math.max(1, rect.scale),
            alpha
        });
    }

    /**
     * 스프라이트 시트 crop을 지정한 화면 영역에 렌더링합니다.
     * @param {{sx:number, sy:number, sw:number, sh:number}} sprite - 스프라이트 source rect입니다.
     * @param {number} x - 화면 x 좌표입니다.
     * @param {number} y - 화면 y 좌표입니다.
     * @param {number} width - 화면 너비입니다.
     * @param {number} height - 화면 높이입니다.
     * @param {number} alpha - 투명도입니다.
     * @private
     */
    #drawSprite(sprite, x, y, width, height, alpha) {
        const spriteRecord = this.#getImage(TYCOON_CONSTANTS.SPRITE_PATH);
        if (!spriteRecord.ready) {
            return;
        }

        render('ui', {
            shape: 'image',
            image: spriteRecord.image,
            sx: sprite.sx,
            sy: sprite.sy,
            sw: sprite.sw,
            sh: sprite.sh,
            x,
            y,
            w: width,
            h: height,
            alpha,
            smoothing: false
        });
    }

    /**
     * 단일 스프라이트 타일을 지정한 화면 사각형에 렌더링합니다.
     * @param {HTMLImageElement} image - 스프라이트 시트 이미지입니다.
     * @param {{sx:number, sy:number, sw:number, sh:number}} sourceRect - source 타일 사각형입니다.
     * @param {{x:number, y:number, w:number, h:number}} targetRect - 화면 타일 사각형입니다.
     * @param {number} alpha - 투명도입니다.
     * @private
     */
    #drawSpriteTile(image, sourceRect, targetRect, alpha) {
        render('ui', {
            shape: 'image',
            image,
            sx: sourceRect.sx,
            sy: sourceRect.sy,
            sw: sourceRect.sw,
            sh: sourceRect.sh,
            x: targetRect.x,
            y: targetRect.y,
            w: targetRect.w,
            h: targetRect.h,
            alpha,
            smoothing: false
        });
    }

    /**
     * 내부 월드 좌표를 화면 좌표 사각형으로 변환합니다.
     * @param {{x:number, y:number, scale:number}} interiorRect - 내부 화면 영역입니다.
     * @param {{x:number, y:number, w:number, h:number}} worldRect - 내부 월드 사각형입니다.
     * @returns {{x:number, y:number, w:number, h:number}} 화면 사각형입니다.
     * @private
     */
    #interiorWorldRectToScreen(interiorRect, worldRect) {
        return {
            x: interiorRect.x + (worldRect.x * interiorRect.scale),
            y: interiorRect.y + (worldRect.y * interiorRect.scale),
            w: worldRect.w * interiorRect.scale,
            h: worldRect.h * interiorRect.scale
        };
    }

    /**
     * 내부 편의점 월드가 들어갈 화면 사각형을 계산합니다.
     * @returns {{x:number, y:number, w:number, h:number, scale:number}} 내부 화면 영역입니다.
     * @private
     */
    #getInteriorScreenRect() {
        const interior = TYCOON_CONSTANTS.INTERIOR;
        const worldWidth = interior.COLUMNS * interior.TILE_SIZE;
        const worldHeight = interior.ROWS * interior.TILE_SIZE;
        const scale = Math.min(
            this.#uww(interior.WIDTH_UIWW) / worldWidth,
            this.#wh(interior.MAX_HEIGHT_WH) / worldHeight
        );
        const width = worldWidth * scale;
        const height = worldHeight * scale;

        return {
            x: this.UIOffsetX + ((this.UIWW - width) * 0.5),
            y: (this.WH - height) * 0.5,
            w: width,
            h: height,
            scale
        };
    }

    /**
     * 외관 타일맵이 들어갈 화면 사각형을 계산합니다.
     * @param {number} sceneScale - 전환 확대 배율입니다.
     * @returns {{x:number, y:number, w:number, h:number, scale:number, tileSize:number}} 외관 화면 영역입니다.
     * @private
     */
    #getExteriorTileMapScreenRect(sceneScale) {
        const exterior = TYCOON_CONSTANTS.EXTERIOR_TILEMAP;
        const worldWidth = exterior.COLUMNS * exterior.TILE_SIZE;
        const worldHeight = exterior.ROWS * exterior.TILE_SIZE;
        const fitScale = Math.min(
            this.#uww(exterior.WIDTH_UIWW) / worldWidth,
            this.#wh(exterior.MAX_HEIGHT_WH) / worldHeight
        );
        const scale = fitScale * sceneScale;
        const width = worldWidth * scale;
        const height = worldHeight * scale;

        return {
            x: this.UIOffsetX + ((this.UIWW - width) * 0.5),
            y: this.#wh(exterior.CENTER_Y_WH) - (height * 0.5),
            w: width,
            h: height,
            scale,
            tileSize: exterior.TILE_SIZE * scale
        };
    }

    /**
     * 스프라이트 시트 이미지가 렌더 가능한지 확인합니다.
     * @returns {boolean} 준비 여부입니다.
     * @private
     */
    #isSpriteReady() {
        return this.#getImage(TYCOON_CONSTANTS.SPRITE_PATH).ready === true;
    }

    /**
     * 현재 표시 중인 슬라이드 데이터를 반환합니다.
     * @returns {{image:string, story:string}} 슬라이드 데이터입니다.
     * @private
     */
    #getCurrentSlide() {
        return TYCOON_CONSTANTS.INTRO.SLIDES[this.currentSlideIndex] || TYCOON_CONSTANTS.INTRO.SLIDES[0];
    }

    /**
     * 텍스트 프리셋을 현재 화면 크기에 맞는 Canvas font 문자열로 변환합니다.
     * @param {object} preset - TEXT_CONSTANTS 프리셋입니다.
     * @returns {string} Canvas font 문자열입니다.
     * @private
     */
    #buildFont(preset) {
        return createFontStringFromPreset(preset, {
            resolveSizePx: (sizeData) => this.#resolveTextSize(sizeData)
        });
    }

    /**
     * 텍스트 크기 단위 데이터를 픽셀 값으로 변환합니다.
     * @param {{BASE:string, VALUE:number}} sizeData - 텍스트 크기 단위 데이터입니다.
     * @returns {number} 픽셀 값입니다.
     * @private
     */
    #resolveTextSize(sizeData) {
        const value = Number(sizeData?.VALUE) || 0;
        if (sizeData?.BASE === 'WH') {
            return this.#wh(value);
        }

        return this.#uww(value);
    }

    /**
     * 스토리 문구를 현재 텍스트 폭에 맞춰 줄바꿈합니다.
     * @param {string} text - 원본 문구입니다.
     * @param {string} font - 측정에 사용할 font 문자열입니다.
     * @returns {string[]} 줄바꿈된 문구입니다.
     * @private
     */
    #wrapStoryText(text, font) {
        const maxWidth = this.#uww(TYCOON_CONSTANTS.INTRO.TEXT_MAX_WIDTH_UIWW);

        return wrapTextByCharacters(text, {
            maxWidth,
            maxLines: 2,
            measureWidth: (line) => measureText(line, font)
        });
    }

    /**
     * 중앙 정렬 텍스트를 렌더링합니다.
     * @param {string} text - 출력할 텍스트입니다.
     * @param {number} y - 텍스트 기준 y 좌표입니다.
     * @param {string} font - Canvas font 문자열입니다.
     * @param {string} fill - 텍스트 색상입니다.
     * @private
     */
    #drawCenteredText(text, y, font, fill) {
        render('ui', {
            shape: 'text',
            text,
            x: this.UIOffsetX + (this.UIWW * 0.5),
            y,
            font,
            fill,
            align: 'center',
            baseline: 'middle'
        });
    }

    /**
     * UI 기준 너비 단위를 픽셀로 변환합니다.
     * @param {number} value - UI 기준 너비 백분율입니다.
     * @returns {number} 픽셀 값입니다.
     * @private
     */
    #uww(value) {
        return this.UIWW * (value / 100);
    }

    /**
     * 화면 높이 단위를 픽셀로 변환합니다.
     * @param {number} value - 화면 높이 백분율입니다.
     * @returns {number} 픽셀 값입니다.
     * @private
     */
    #wh(value) {
        return this.WH * (value / 100);
    }

    /**
     * 값을 0~1 범위로 제한합니다.
     * @param {number} value - 제한할 값입니다.
     * @returns {number} 제한된 값입니다.
     * @private
     */
    #clamp01(value) {
        return Math.max(0, Math.min(1, Number(value) || 0));
    }

    /**
     * 부드러운 확대 전환을 위한 cubic easing 값을 계산합니다.
     * @param {number} value - 0~1 진행도입니다.
     * @returns {number} easing 적용 진행도입니다.
     * @private
     */
    #easeInOutCubic(value) {
        const t = this.#clamp01(value);
        if (t < 0.5) {
            return 4 * t * t * t;
        }

        return 1 - (((-2 * t) + 2) ** 3 / 2);
    }
}
