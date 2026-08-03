import { GLOBAL_CONSTANTS } from 'data/global/global_constants.js';
import { APP_PAUSE_DATA } from 'data/global/app_pause_data.js';
import { SYSTEM_RUNTIME_POLICY_DATA } from 'data/global/system_runtime_policy_data.js';
import {
    LightTheme,
    DarkTheme,
    THEMES,
    THEME_KEYS,
    THEME_OPTIONS,
    DEFAULT_THEME_KEY,
    getThemeByKey
} from 'data/theme/theme_registry.js';
import { BUTTON_CONSTANTS } from 'data/ui/layout/button_constants.js';
import { UI_CONSTANTS } from 'data/ui/layout/ui_constants.js';
import { TEXT_CONSTANTS } from 'data/ui/typography/text_constants.js';
import { CURSOR_CONSTANTS } from 'data/ui/cursor/cursor_constants.js';
import { TOOLTIP_CONSTANTS } from 'data/ui/tooltip/tooltip_constants.js';
import { SIMULATION_RUNTIME_DEFAULTS } from 'data/simulation/simulation_runtime_defaults.js';
import { DEBUG_CONSTANTS } from 'data/debug/debug_constants.js';
import { SOUND_CONSTANTS } from 'data/sound/sound_constants.js';
import { SCENE_TRANSITION_CONSTANTS } from 'data/scene/scene_transition_constants.js';
import { TITLE_SCENE_CONSTANTS } from 'data/scene/title/title_scene_constants.js';
import { GAME_SCENE_CONSTANTS } from 'data/scene/game/game_scene_constants.js';
import { TYCOON_SCENE_CONSTANTS } from 'data/scene/tycoon/tycoon_scene_constants.js';
import { AERO_LIVE_SCENE_CONSTANTS } from 'data/scene/aero_live/aero_live_scene_constants.js';
import {
    DEFAULT_OVERLAY_ANIMATION_PRESET,
    OVERLAY_ANIMATION_PRESETS,
    getOverlayAnimationPreset
} from 'data/overlay/overlay_animation_presets.js';
import { OVERLAY_LAYOUT_CONSTANTS } from 'data/overlay/overlay_layout_constants.js';
import { WEBGL_CONSTANTS } from 'data/display/webgl_constants.js';
import { EFFECT_RENDER_CONSTANTS } from 'data/display/effect_render_constants.js';
import { OVERLAY_RENDER_CONSTANTS } from 'data/display/overlay_render_constants.js';
import { VIGNETTE_CONSTANTS } from 'data/display/vignette_constants.js';
import { DISPLAY_SURFACE_DATA } from 'data/display/display_surface_data.js';
import { MOUSE_BUTTON_INPUT_DATA } from 'data/input/mouse_button_input_data.js';

const DATA_REGISTRY = Object.freeze({
    GLOBAL_CONSTANTS,
    APP_PAUSE_DATA,
    SYSTEM_RUNTIME_POLICY_DATA,
    LightTheme,
    DarkTheme,
    THEMES,
    THEME_KEYS,
    THEME_OPTIONS,
    DEFAULT_THEME_KEY,
    getThemeByKey,
    BUTTON_CONSTANTS,
    UI_CONSTANTS,
    TEXT_CONSTANTS,
    CURSOR_CONSTANTS,
    TOOLTIP_CONSTANTS,
    SIMULATION_RUNTIME_DEFAULTS,
    DEBUG_CONSTANTS,
    SOUND_CONSTANTS,
    SCENE_TRANSITION_CONSTANTS,
    TITLE_SCENE_CONSTANTS,
    GAME_SCENE_CONSTANTS,
    TYCOON_SCENE_CONSTANTS,
    AERO_LIVE_SCENE_CONSTANTS,
    DEFAULT_OVERLAY_ANIMATION_PRESET,
    OVERLAY_ANIMATION_PRESETS,
    getOverlayAnimationPreset,
    OVERLAY_LAYOUT_CONSTANTS,
    WEBGL_CONSTANTS,
    EFFECT_RENDER_CONSTANTS,
    OVERLAY_RENDER_CONSTANTS,
    VIGNETTE_CONSTANTS,
    DISPLAY_SURFACE_DATA,
    MOUSE_BUTTON_INPUT_DATA
});

/**
 * 지정된 키에 해당하는 데이터를 반환합니다.
 * @param {string} key 데이터 키
 * @returns {any} 등록된 데이터
 */
export const getData = (key) => {
    if (!Object.prototype.hasOwnProperty.call(DATA_REGISTRY, key)) {
        throw new Error(`[DataHandler] Unknown data key: ${key}`);
    }
    return DATA_REGISTRY[key];
};
