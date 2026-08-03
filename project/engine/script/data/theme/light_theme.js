import { OVERLAY_BUTTON_COMMON } from './theme_shared.js';

/**
 * 라이트 테마 오버레이 전용 색상 및 속성 정의
 */
const LIGHT_OVERLAY_THEME = Object.freeze({
    Text: Object.freeze({
        Title: '#29224b',
        Sub: '#7a5d70',
        Section: '#b98471',
        Item: '#3b2a4d',
        Control: '#5d496b',
        Value: '#29224b'
    }),
    Panel: Object.freeze({
        Background: '#f5dccd',
        Border: '#29224b',
        GlassBackground: '#f5dccd',
        GlassBorder: '#29224b',
        GlassTint: '#f5dccd',
        GlassTintStrength: 0,
        GlassEdge: '#29224b',
        GlassEdgeStrength: 0,
        Divider: '#8d6b75',
        Dim: 0.5,
        Shadow: 'rgba(41, 34, 75, 0.28)'
    }),
    Control: Object.freeze({
        Background: '#b98471',
        Accent: '#e986a0',
        Inactive: '#b98471',
        Hover: '#d79a8c'
    }),
    Button: Object.freeze({
        ...OVERLAY_BUTTON_COMMON,
        Link: Object.freeze({
            Idle: '#f2d8df',
            Hover: '#e986a0',
            Text: '#29224b'
        }),
        Option: Object.freeze({
            Active: '#e986a0',
            ActiveText: '#29224b'
        })
    }),
    Segment: Object.freeze({
        Background: '#b98471',
        Thumb: '#f2d8df',
        TextActive: '#29224b',
        TextInactive: '#fff0df'
    }),
    Toggle: Object.freeze({
        Active: '#e986a0',
        Inactive: '#b98471',
        Knob: '#fff0df',
        Shadow: 'rgba(41, 34, 75, 0.28)'
    }),
    Slider: Object.freeze({
        Track: '#b98471',
        ValueActive: '#e986a0',
        ValueInactive: '#5d496b',
        Knob: '#fff0df',
        Shadow: 'rgba(41, 34, 75, 0.28)'
    })
});

/**
 * 라이트 테마 비네팅 전용 속성 정의
 */
const LIGHT_VIGNETTE_THEME = Object.freeze({
    WORLD: Object.freeze({
        RGB: Object.freeze([32, 32, 32]),
        AlphaMultiplier: 0.58
    })
});

/**
 * 엔진 런타임에 적용되는 라이트 테마 설정 모음
 */
export const LightTheme = Object.freeze({
    Background: '#e8cdd2',
    Cursor: Object.freeze({
        Fill: '#29224b',
        Active: '#fff0df',
        White: '#fff0df'
    }),
    Overlay: LIGHT_OVERLAY_THEME,
    Vignette: LIGHT_VIGNETTE_THEME,
    Debug: Object.freeze({
        Background: '#29224b',
        Fill: '#29224b',
        Text: '#29224b'
    })
});
