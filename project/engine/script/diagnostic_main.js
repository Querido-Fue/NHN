import { EngineApp } from 'engine/app/engine_app.js';
import { SystemHandler } from 'core/system_handler.js';
import { DiagnosticScene } from 'engine/scene/diagnostic/_diagnostic_scene.js';
import { TimeHandler } from 'engine/time_handler.js';
import { MathUtil } from 'util/math_util.js';
import { ColorUtil } from 'util/color_util.js';
import { RuntimeTool } from 'util/runtime_tool.js';

let systemHandler;
let EngineDiagnostic;

/**
 * 엔진 diagnostic 진입점입니다.
 * display/input/overlay 기준선을 확인하는 최소 엔진 런타임을 띄웁니다.
 */
window.onload = async () => {
    try {
        new TimeHandler();
        new MathUtil();
        new ColorUtil();
        new RuntimeTool();

        systemHandler = new SystemHandler({
            sceneSystem: {
                initialSceneState: 'diagnostic',
                initialSceneFactory: (sceneSystem) => new DiagnosticScene(sceneSystem)
            }
        });
        await systemHandler.init();

        EngineDiagnostic = new EngineApp(systemHandler);
        window.Game = EngineDiagnostic;
        window.EngineDiagnostic = EngineDiagnostic;
        EngineDiagnostic.start();
    } catch (e) {
        console.warn("엔진 진단 런타임 초기화 중 오류가 발생했습니다\n", e);
    }
};

/**
 * 창 크기 변경 시 diagnostic 화면을 리사이즈합니다.
 */
window.addEventListener('resize', () => {
    if (EngineDiagnostic) {
        EngineDiagnostic.resize();
    }
});
