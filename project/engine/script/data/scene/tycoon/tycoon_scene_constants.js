/**
 * 타이쿤 씬의 인트로 이미지, 문구, 표시 레이아웃 데이터입니다.
 */
export const TYCOON_SCENE_CONSTANTS = Object.freeze({
    SPRITE_PATH: '../asset/image/tycoon/sprite.png',
    COLORS: Object.freeze({
        EXTERIOR_SKY: '#78cfe7',
        EXTERIOR_GROUND: '#d6e7e2',
        INTERIOR_WALL: '#f5f0df',
        INTERIOR_FLOOR_A: '#d9e5ee',
        INTERIOR_FLOOR_B: '#c7d8e4',
        INTERIOR_GRID: 'rgba(82, 103, 128, 0.18)',
        INTERIOR_SHADOW: 'rgba(23, 28, 35, 0.18)',
        INTERIOR_OUTLINE: '#51657d',
        INTERIOR_DOOR: '#536480',
        INTERIOR_COUNTER: '#d99a45',
        INTERIOR_COUNTER_TOP: '#fff1c7'
    }),
    SPRITES: Object.freeze({
        DOOR: Object.freeze({ sx: 165, sy: 425, sw: 17, sh: 29 }),
        CHECKOUT_COUNTER: Object.freeze({ sx: 528, sy: 100, sw: 48, sh: 24 })
    }),
    EXTERIOR_TILEMAP: Object.freeze({
        TILE_SIZE: 16,
        SOURCE_X: 0,
        SOURCE_Y: 0,
        COLUMNS: 20,
        ROWS: 32,
        WIDTH_UIWW: 44,
        MAX_HEIGHT_WH: 86,
        CENTER_Y_WH: 50,
        GROUND_Y_WH: 76
    }),
    INTRO: Object.freeze({
        CLICK_PROMPT: '클릭하여 계속',
        TEXT_MAX_WIDTH_UIWW: 76,
        STORY_BASELINE_WH: 83,
        PROMPT_BASELINE_WH: 91,
        STORY_LINE_GAP_WH: 3.4,
        BOTTOM_DIM_HEIGHT_WH: 30,
        BOTTOM_DIM_ALPHA: 0.58,
        IMAGE_DIM_ALPHA: 0.08,
        SLIDES: Object.freeze([
            Object.freeze({
                image: '../asset/image/intro/intro1.png',
                story: '할아버지가 설레는 마음으로 편의점 부지를 구매했다.'
            }),
            Object.freeze({
                image: '../asset/image/intro/intro2.png',
                story: '하지만 그 부지는 땅이 아니라 단순히 배였다!'
            }),
            Object.freeze({
                image: '../asset/image/intro/intro3.png',
                story: '할아버지는 너무 화가 나서, 꼬리를 흔들면서 씩씩 거리다가...'
            }),
            Object.freeze({
                image: '../asset/image/intro/intro4.png',
                story: '꼬리콥터 병에 걸리고 말았다! 언젠가는 하늘로 영영 날아가버릴지도 몰라...'
            }),
            Object.freeze({
                image: '../asset/image/intro/intro5.png',
                story: '꼬리콥터 병에 걸린 할아버지를 치료하기 위해 나는 이거라도 경영해서 돈을 모아야 한다.'
            })
        ])
    }),
    EXTERIOR_TRANSITION: Object.freeze({
        DURATION_SECONDS: 1.8,
        START_SCALE: 1,
        END_SCALE: 1.22,
        INTERIOR_FADE_START: 0.62
    }),
    INTERIOR: Object.freeze({
        TILE_SIZE: 12,
        COLUMNS: 30,
        ROWS: 18,
        WIDTH_UIWW: 70,
        MAX_HEIGHT_WH: 66,
        WALL_HEIGHT_TILES: 3,
        SHADOW_OFFSET_TILES: 0.28,
        DOOR: Object.freeze({
            TILE_X: 14,
            TILE_Y: 16,
            TILE_WIDTH: 1,
            TILE_HEIGHT: 1
        }),
        CHECKOUT_COUNTER: Object.freeze({
            TILE_X: 13,
            TILE_Y: 7,
            TILE_WIDTH: 4,
            TILE_HEIGHT: 2
        })
    })
});
