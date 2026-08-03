import { OVERLAY_BUTTON_COMMON } from './theme_shared.js';

/**
 * 다크 테마 오버레이 전용 색상 및 속성 정의
 */
const DARK_OVERLAY_THEME = Object.freeze({
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
        Dim: 0.48,
        Shadow: 'rgba(20, 16, 31, 0.45)'
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
        Shadow: 'rgba(20, 16, 31, 0.35)'
    }),
    Slider: Object.freeze({
        Track: '#b98471',
        ValueActive: '#e986a0',
        ValueInactive: '#5d496b',
        Knob: '#fff0df',
        Shadow: 'rgba(20, 16, 31, 0.35)'
    })
});

/**
 * 다크 테마 비네팅 전용 속성 정의
 */
const DARK_VIGNETTE_THEME = Object.freeze({
    WORLD: Object.freeze({
        RGB: Object.freeze([0, 0, 0]),
        AlphaMultiplier: 0.4416
    })
});

/**
 * 엔진 런타임에 적용되는 다크 테마 설정 모음
 */
export const DarkTheme = Object.freeze({
    Background: '#14101f',
    Cursor: Object.freeze({
        Fill: '#29224b',
        Active: '#fff0df',
        White: '#fff0df'
    }),
    Overlay: DARK_OVERLAY_THEME,
    Vignette: DARK_VIGNETTE_THEME,
    Debug: Object.freeze({
        Background: '#fff0df',
        Fill: '#fff0df',
        Text: '#fff0df'
    })
});
