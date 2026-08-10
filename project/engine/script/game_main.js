import { EngineApp } from 'engine/app/engine_app.js';
import { SystemHandler } from 'core/system_handler.js';
import { AeroLiveScene } from 'scene/aero_live/_aero_live_scene.js';
import { TimeHandler } from 'engine/time_handler.js';
import { MathUtil } from 'util/math_util.js';
import { ColorUtil } from 'util/color_util.js';
import { RuntimeTool } from 'util/runtime_tool.js';

let systemHandler;
let GameApp;

/**
 * 게임 런타임 진입점입니다.
 * 엔진 시스템을 초기화한 뒤 AERO LIVE 주제 선택 화면을 띄웁니다.
 */
export async function initializeGameRuntime() {
    try {
        const smokeState = window.__AERO_LIVE_NW_SMOKE_STATE__;
        if (smokeState) smokeState.stage = 'utilities';
        new TimeHandler();
        new MathUtil();
        new ColorUtil();
        new RuntimeTool();

        systemHandler = new SystemHandler({
            sceneSystem: {
                initialSceneState: 'aeroLive',
                initialSceneFactory: (sceneSystem) => new AeroLiveScene(sceneSystem),
                sceneFactories: {
                    aeroLive: (sceneSystem) => new AeroLiveScene(sceneSystem)
                }
            }
        });
        if (smokeState) smokeState.stage = 'system-init';
        await systemHandler.init();

        if (smokeState) smokeState.stage = 'engine-app';
        GameApp = new EngineApp(systemHandler);
        window.Game = GameApp;
        GameApp.start();
        if (smokeState) smokeState.stage = 'ready';
        return GameApp;
    } catch (e) {
        const smokeState = window.__AERO_LIVE_NW_SMOKE_STATE__;
        if (smokeState) {
            smokeState.stage = 'failed';
            smokeState.error = String(e?.message || e || 'UNKNOWN_ERROR').slice(0, 300);
        }
        console.warn('게임 런타임 초기화 중 오류가 발생했습니다.\n', e);
        return null;
    }
}

/**
 * 창 크기 변경 시 현재 게임 화면을 리사이즈합니다.
 */
window.addEventListener('resize', () => {
    if (GameApp) {
        GameApp.resize();
    }
});
