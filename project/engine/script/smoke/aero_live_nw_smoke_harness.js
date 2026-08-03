import { nw } from 'util/nw_bridge.js';

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;
const WAIT_TIMEOUT_MS = 15000;
const errors = [];
const warnings = [];
const nodeRequire = window.require;
const fs = nodeRequire('fs');
const path = nodeRequire('path');
const crypto = nodeRequire('crypto');
const nodeProcess = nodeRequire('process');

/**
 * 알 수 없는 값을 비밀정보를 포함하지 않는 짧은 진단 문자열로 바꿉니다.
 * @param {*} value - 원본 값입니다.
 * @returns {string} 진단 문자열입니다.
 */
function safeDiagnostic(value) {
    const raw = String(value?.message || value || 'UNKNOWN_ERROR');
    if (/^NW_SMOKE_[A-Z_]+(?::[a-z0-9-]+)?$/u.test(raw)) {
        return raw;
    }
    return raw
        .replace(/[A-Za-z0-9_-]{24,}/gu, '[REDACTED]')
        .slice(0, 300);
}

/**
 * 조건이 참이 될 때까지 짧게 폴링합니다.
 * @param {() => *} predicate - 값을 반환할 조건 함수입니다.
 * @param {string} label - 시간초과 오류 라벨입니다.
 * @param {number} [timeoutMs=WAIT_TIMEOUT_MS] - 최대 대기 시간입니다.
 * @returns {Promise<*>} 조건 함수가 반환한 truthy 값입니다.
 */
async function waitFor(predicate, label, timeoutMs = WAIT_TIMEOUT_MS) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const value = predicate();
        if (value) {
            return value;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 40));
    }
    throw new Error(`NW_SMOKE_TIMEOUT:${label}`);
}

/**
 * 테스트 출력 디렉터리를 고정된 워크스페이스 하위 경로로 제한합니다.
 * @returns {{runId:string,outputDirectory:string,reportPath:string}} 출력 경로입니다.
 */
function resolveOutputPaths() {
    const smokeArgument = Array.isArray(nw.App.fullArgv)
        ? nw.App.fullArgv.find((argument) => String(argument).startsWith('--aero-live-nw-smoke='))
        : null;
    const runIdFromArgument = String(smokeArgument || '').slice('--aero-live-nw-smoke='.length);
    const runId = runIdFromArgument || String(nodeProcess.env?.AERO_LIVE_NW_SMOKE_RUN_ID || '');
    if (!RUN_ID_PATTERN.test(runId)) {
        throw new Error('NW_SMOKE_INVALID_RUN_ID');
    }

    const workspaceRoot = path.resolve(nw.App.startPath, '..');
    const outputBase = path.resolve(workspaceRoot, 'evaluation', 'artifacts', 'aero-live-nw');
    const outputDirectory = path.resolve(outputBase, runId);
    if (path.dirname(outputDirectory) !== outputBase) {
        throw new Error('NW_SMOKE_UNSAFE_OUTPUT_PATH');
    }
    if (!fs.existsSync(outputBase) || !fs.existsSync(outputDirectory)) {
        throw new Error('NW_SMOKE_OUTPUT_NOT_PREPARED');
    }
    const workspaceReal = fs.realpathSync(workspaceRoot);
    const outputBaseReal = fs.realpathSync(outputBase);
    const relativeBase = path.relative(workspaceReal, outputBaseReal);
    if (!relativeBase
        || relativeBase.startsWith('..')
        || path.isAbsolute(relativeBase)) {
        throw new Error('NW_SMOKE_REALPATH_BOUNDARY');
    }
    const outputDirectoryReal = fs.realpathSync(outputDirectory);
    if (path.dirname(outputDirectoryReal).toLowerCase() !== outputBaseReal.toLowerCase()) {
        throw new Error('NW_SMOKE_REALPATH_BOUNDARY');
    }
    return {
        runId,
        outputDirectory: outputDirectoryReal,
        reportPath: path.join(outputDirectoryReal, 'report.json')
    };
}

/**
 * 실제 NW 창의 보이는 영역을 PNG 파일로 캡처합니다.
 * @param {object} nativeWindow - NW Window입니다.
 * @param {string} outputPath - 검증된 출력 파일 경로입니다.
 * @returns {Promise<{bytes:number,sha256:string}>} 파일 메타데이터입니다.
 */
async function capturePng(nativeWindow, outputPath) {
    const captureOnce = () => new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback) => (value) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            callback(value);
        };
        const resolveOnce = finish(resolve);
        const rejectOnce = finish(reject);
        const timeoutId = window.setTimeout(
            () => rejectOnce(new Error('NW_SMOKE_CAPTURE_TIMEOUT')),
            5000
        );
        try {
            nativeWindow.capturePage((buffer) => {
                if (settled) return;
                try {
                    if (!Buffer.isBuffer(buffer) || buffer.length < 1024) {
                        throw new Error('NW_SMOKE_EMPTY_CAPTURE');
                    }
                    fs.writeFileSync(outputPath, buffer);
                    resolveOnce({
                        bytes: buffer.length,
                        sha256: crypto.createHash('sha256').update(buffer).digest('hex')
                    });
                } catch (error) {
                    rejectOnce(error);
                }
            }, { format: 'png', datatype: 'buffer' });
        } catch (error) {
            rejectOnce(error);
        }
    });

    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
            nativeWindow.hide();
            await new Promise((resolve) => window.setTimeout(resolve, 120));
        }
        nativeWindow.show();
        nativeWindow.focus();
        window.Game?.clearPauseReason?.('app-inactive');
        await waitForPaint();
        try {
            return await captureOnce();
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('NW_SMOKE_CAPTURE_FAILED');
}

/**
 * 실제 전체화면 캡처가 최소 크기와 16:9 비율을 만족하는지 검사합니다.
 * @param {number} width - 캡처 폭입니다.
 * @param {number} height - 캡처 높이입니다.
 * @returns {boolean} 유효한 검증 화면 여부입니다.
 */
function isValidCaptureViewport(width, height) {
    return width === CAPTURE_WIDTH
        && Math.abs(height - CAPTURE_HEIGHT) <= 2;
}

/**
 * 현재 NW 창이 놓인 디스플레이의 물리 배율을 반환합니다.
 * @returns {number} 양의 display scale factor입니다.
 */
function getDisplayScaleFactor() {
    try {
        if (!Array.isArray(nw.Screen.screens) || nw.Screen.screens.length === 0) {
            nw.Screen.Init();
        }
        const nativeWindow = nw.Window.get();
        const centerX = numberOr(nativeWindow.x, 0) + window.innerWidth / 2;
        const centerY = numberOr(nativeWindow.y, 0) + window.innerHeight / 2;
        const screens = Array.isArray(nw.Screen.screens) ? nw.Screen.screens : [];
        const screen = screens.find((candidate) => {
            const bounds = candidate?.bounds;
            return bounds
                && centerX >= bounds.x
                && centerX < bounds.x + bounds.width
                && centerY >= bounds.y
                && centerY < bounds.y + bounds.height;
        }) || screens[0];
        return Number.isFinite(screen?.scaleFactor) && screen.scaleFactor > 0
            ? screen.scaleFactor
            : (window.devicePixelRatio || 1);
    } catch {
        return window.devicePixelRatio || 1;
    }
}

/** 알 수 없는 값을 유한한 숫자로 바꿉니다. */
function numberOr(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * NW/Windows 배율 차이를 실제 측정값으로 보정해 한 축의 inner size를 맞춥니다.
 * @param {(value:number) => void} setter - NW 크기 setter입니다.
 * @param {() => number} reader - 현재 CSS inner size reader입니다.
 * @param {number} target - 목표 CSS 크기입니다.
 * @param {string} label - 실패 진단 라벨입니다.
 */
async function fitInnerDimension(setter, reader, target, label) {
    let requested = target;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        setter(Math.max(1, Math.round(requested)));
        await new Promise((resolve) => window.setTimeout(resolve, 140));
        const current = reader();
        if (Math.abs(current - target) <= 2) return;
        requested *= target / Math.max(1, current);
    }
    throw new Error(`NW_SMOKE_TIMEOUT:${label}`);
}

/**
 * 캡처 프로세스의 창만 16:9 창 모드로 전환해 Chromium 합성 스로틀링을 피합니다.
 * 프로젝트의 저장 설정은 변경하지 않습니다.
 * @param {object} nativeWindow - NW Window입니다.
 * @param {object} game - EngineApp입니다.
 * @returns {Promise<void>}
 */
async function prepareCaptureWindow(nativeWindow, game) {
    nativeWindow.leaveFullscreen();
    await new Promise((resolve) => window.setTimeout(resolve, 240));
    nativeWindow.zoomLevel = 0;
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    await fitInnerDimension(
        (value) => nativeWindow.setInnerWidth(value),
        () => window.innerWidth,
        CAPTURE_WIDTH,
        'capture-window-width'
    );
    await fitInnerDimension(
        (value) => nativeWindow.setInnerHeight(value),
        () => window.innerHeight,
        CAPTURE_HEIGHT,
        'capture-window-height'
    );
    await waitFor(
        () => isValidCaptureViewport(window.innerWidth, window.innerHeight),
        'capture-window-size',
        5000
    );
    nativeWindow.show();
    nativeWindow.focus();
    nativeWindow.setAlwaysOnTop?.(true);
    game.clearPauseReason?.('app-inactive');
    window.dispatchEvent(new Event('resize'));
    game.resize();
    await waitForPaint();
}

/**
 * 비활성 창에서도 Chromium이 새 Canvas/DOM 상태를 합성하도록 창 높이를 1px 왕복합니다.
 * @param {object} nativeWindow - NW Window입니다.
 * @param {object} game - EngineApp입니다.
 * @returns {Promise<void>}
 */
async function forceCompositorRefresh(nativeWindow, game) {
    const originalHeight = window.innerHeight;
    nativeWindow.setInnerHeight(originalHeight + 1);
    await waitFor(() => window.innerHeight !== originalHeight, 'compositor-resize-out', 2000);
    nativeWindow.setInnerHeight(originalHeight);
    await waitFor(() => window.innerHeight === originalHeight, 'compositor-resize-back', 2000);
    game.clearPauseReason?.('app-inactive');
    window.dispatchEvent(new Event('resize'));
    game.resize();
    await new Promise((resolve) => window.setTimeout(resolve, 100));
}

/**
 * Scene과 엔진 렌더 surface를 한 번 직접 그려 숨은 창에서도 캡처를 안정화합니다.
 * @param {object} game - EngineApp입니다.
 * @param {object} scene - 현재 AERO LIVE Scene입니다.
 */
function renderNow(game, scene) {
    scene.update();
    const displaySystem = game.systemHandler?.displaySystem;
    displaySystem?.drawHandler?.clearAll?.();
    displaySystem?.webGLHandler?.clearAll?.();
    scene.draw();
    displaySystem?.webGLHandler?.flushAll?.();
}

/**
 * Canvas 변경이 Chromium 합성 표면에 반영될 때까지 기다립니다.
 * 비활성 창에서 rAF가 지연될 경우 짧은 타임아웃으로 테스트 교착을 막습니다.
 * @returns {Promise<void>}
 */
function waitForPaint() {
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            resolve();
        };
        const timeoutId = window.setTimeout(finish, 500);
        window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
    });
}

/**
 * DOM Composer의 화면 내 정렬 상태를 직렬화합니다.
 * @param {object} scene - 현재 Scene입니다.
 * @returns {object} DOM 검사 결과입니다.
 */
function inspectComposer(scene) {
    const form = document.querySelector('.aero-live-composer');
    if (!form) {
        return { exists: false };
    }
    const rect = form.getBoundingClientRect();
    const uiCanvas = document.querySelector('#ui');
    const canvasRect = uiCanvas?.getBoundingClientRect?.();
    const logicalRect = scene.layout?.composer;
    const expectedRect = canvasRect && logicalRect && scene.WW > 0 && scene.WH > 0
        ? {
            x: canvasRect.left + (logicalRect.x / scene.WW) * canvasRect.width,
            y: canvasRect.top + (logicalRect.y / scene.WH) * canvasRect.height,
            width: (logicalRect.w / scene.WW) * canvasRect.width,
            height: (logicalRect.h / scene.WH) * canvasRect.height
        }
        : null;
    const alignmentError = expectedRect
        ? Math.max(
            Math.abs(rect.x - expectedRect.x),
            Math.abs(rect.y - expectedRect.y),
            Math.abs(rect.width - expectedRect.width),
            Math.abs(rect.height - expectedRect.height)
        )
        : null;
    return {
        exists: true,
        display: getComputedStyle(form).display,
        disabled: form.querySelector('input[type="text"]')?.disabled === true,
        rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom)
        },
        withinViewport: rect.left >= -1
            && rect.top >= -1
            && rect.right <= window.innerWidth + 1
            && rect.bottom <= window.innerHeight + 1,
        alignmentError: Number.isFinite(alignmentError) ? Number(alignmentError.toFixed(3)) : null,
        alignedToCanvas: Number.isFinite(alignmentError) && alignmentError <= 3,
        sceneMode: scene.mode
    };
}

/**
 * 완성된 리포트를 같은 디렉터리의 임시 파일에서 원자적으로 교체합니다.
 * @param {{reportPath:string}} paths - 검증된 출력 경로입니다.
 * @param {object} report - 직렬화할 리포트입니다.
 */
function writeReportAtomic(paths, report) {
    const temporaryPath = `${paths.reportPath}.tmp-${nodeProcess.pid}`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, paths.reportPath);
}

/**
 * 화면 상태 하나를 그리고 PNG로 남깁니다.
 * @param {object} state - 캡처 상태입니다.
 * @returns {Promise<object>} 화면 메타데이터입니다.
 */
async function captureState(state) {
    fs.writeFileSync(
        path.join(state.paths.outputDirectory, 'stage.txt'),
        `capture-${state.name}-start\n`,
        'utf8'
    );
    await forceCompositorRefresh(state.nativeWindow, state.game);
    renderNow(state.game, state.scene);
    await waitForPaint();
    renderNow(state.game, state.scene);
    await waitForPaint();
    const fileName = `${state.order}-${state.name}.png`;
    const outputPath = path.join(state.paths.outputDirectory, fileName);
    await capturePng(state.nativeWindow, outputPath);
    renderNow(state.game, state.scene);
    await waitForPaint();
    const capture = await capturePng(state.nativeWindow, outputPath);
    fs.writeFileSync(
        path.join(state.paths.outputDirectory, 'stage.txt'),
        `capture-${state.name}-complete\n`,
        'utf8'
    );
    return {
        name: state.name,
        fileName,
        mode: state.scene.mode,
        status: state.scene.snapshot?.status || 'unknown',
        window: { width: window.innerWidth, height: window.innerHeight },
        composer: inspectComposer(state.scene),
        ...capture
    };
}

/**
 * 실제 NW.js AERO LIVE 창에서 네 화면과 구조 검사를 수행합니다.
 */
async function runSmoke() {
    let paths;
    let report;
    try {
        paths = resolveOutputPaths();
        fs.writeFileSync(path.join(paths.outputDirectory, 'stage.txt'), 'run-start\n', 'utf8');
        const nativeWindow = nw.Window.get();
        const game = await waitFor(() => window.Game, 'game-ready');
        fs.writeFileSync(path.join(paths.outputDirectory, 'stage.txt'), 'game-ready\n', 'utf8');
        const scene = await waitFor(
            () => game.systemHandler?.sceneSystem?.scene,
            'scene-ready'
        );
        fs.writeFileSync(path.join(paths.outputDirectory, 'stage.txt'), 'scene-ready\n', 'utf8');
        await waitFor(
            () => {
                const status = scene.renderer?.getHeroAssetStatus?.();
                return status?.ready || status?.failed;
            },
            'hero-images'
        );
        fs.writeFileSync(path.join(paths.outputDirectory, 'stage.txt'), 'hero-ready\n', 'utf8');
        await prepareCaptureWindow(nativeWindow, game);
        fs.writeFileSync(path.join(paths.outputDirectory, 'stage.txt'), 'capture-window-ready\n', 'utf8');

        scene.aiService.generateChatBatch = async () => ({ chats: [], source: 'nw-smoke-disabled' });
        scene.aiService.classifyPlayerMessage = async () => ({
            intent: 'blocked',
            confidence: 0,
            reason: 'NW smoke에서는 외부 판정을 호출하지 않습니다.',
            reaction_chats: [],
            source: 'technical-failure'
        });

        const captures = [];
        captures.push(await captureState({
            game, scene, nativeWindow, paths, order: '01', name: 'topics'
        }));

        scene.snapshot = scene.runtime.startBroadcast('game');
        scene.mode = 'live';
        for (let tick = 0; tick < 130; tick += 1) {
            scene.fixedUpdate();
        }
        await Promise.resolve();
        const liveFallbackChatCount = scene.snapshot?.chats
            ?.filter((chat) => chat.source === 'fallback').length || 0;
        captures.push(await captureState({
            game, scene, nativeWindow, paths, order: '02', name: 'live'
        }));

        scene.earlyEndModalOpen = true;
        captures.push(await captureState({
            game, scene, nativeWindow, paths, order: '03', name: 'early-end-modal'
        }));

        scene.earlyEndModalOpen = false;
        const earlyEnd = scene.runtime.requestEarlyEnd();
        scene.fixedUpdate();
        captures.push(await captureState({
            game, scene, nativeWindow, paths, order: '04', name: 'results'
        }));

        const canvasStates = [...document.querySelectorAll('canvas')].map((canvas) => ({
            id: canvas.id,
            width: canvas.width,
            height: canvas.height,
            cssWidth: Math.round(canvas.getBoundingClientRect().width),
            cssHeight: Math.round(canvas.getBoundingClientRect().height)
        }));
        report = {
            ok: true,
            runId: paths.runId,
            runtime: {
                nwVersion: nodeProcess.versions?.nw || null,
                chromiumVersion: nodeProcess.versions?.chromium || null,
                nodeVersion: nodeProcess.versions?.node || null
            },
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio || 1,
                displayScaleFactor: getDisplayScaleFactor()
            },
            heroAssets: scene.renderer?.getHeroAssetStatus?.() || null,
            liveState: {
                fallbackChatCount: liveFallbackChatCount,
                earlyEndAccepted: earlyEnd?.accepted === true
            },
            result: {
                endType: scene.snapshot?.endType,
                hasResult: !!scene.snapshot?.result,
                topicId: scene.snapshot?.topic?.id || scene.snapshot?.result?.topic?.id || null
            },
            canvasStates,
            captures,
            errors,
            warnings
        };
        report.ok = report.heroAssets?.ready === true
            && report.heroAssets?.failed === false
            && report.heroAssets?.requestedCount > 0
            && report.heroAssets?.readyCount === report.heroAssets?.requestedCount
            && report.heroAssets?.failedCount === 0
            && isValidCaptureViewport(report.viewport.width, report.viewport.height)
            && report.liveState.fallbackChatCount > 0
            && report.liveState.earlyEndAccepted
            && report.result.endType === 'early'
            && report.result.hasResult
            && report.captures[0].composer.display === 'none'
            && report.captures[1].composer.display !== 'none'
            && report.captures[1].composer.withinViewport
            && report.captures[1].composer.alignedToCanvas
            && report.captures[2].composer.display === 'none'
            && report.captures[3].composer.display === 'none'
            && canvasStates.length >= 7
            && canvasStates.every((canvas) => canvas.width > 0 && canvas.height > 0)
            && errors.length === 0
            && warnings.length === 0;
        fs.writeFileSync(path.join(paths.outputDirectory, 'stage.txt'), 'captures-complete\n', 'utf8');
    } catch (error) {
        errors.push({ type: 'harness', message: safeDiagnostic(error) });
        if (!paths) {
            paths = resolveOutputPaths();
        }
        report = {
            ok: false,
            runId: paths.runId,
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio || 1,
                displayScaleFactor: getDisplayScaleFactor()
            },
            initialization: window.__AERO_LIVE_NW_SMOKE_STATE__ || null,
            errors,
            warnings
        };
        fs.writeFileSync(path.join(paths.outputDirectory, 'stage.txt'), 'caught-error\n', 'utf8');
    } finally {
        try {
            writeReportAtomic(paths, report);
        } catch (error) {
            console.error('[AeroLiveNwSmoke] report write failed', safeDiagnostic(error));
        }
        window.setTimeout(() => nw.App.quit(), 180);
    }
}

window.addEventListener('error', (event) => {
    errors.push({ type: 'error', message: safeDiagnostic(event.error || event.message) });
});
window.addEventListener('unhandledrejection', (event) => {
    errors.push({ type: 'unhandledrejection', message: safeDiagnostic(event.reason) });
});
const originalConsoleError = console.error.bind(console);
console.error = (...values) => {
    errors.push({
        type: 'console.error',
        message: values.map((value) => safeDiagnostic(value)).join(' | ').slice(0, 500)
    });
    originalConsoleError(...values);
};
const originalConsoleWarn = console.warn.bind(console);
console.warn = (...values) => {
    warnings.push({
        type: 'console.warn',
        message: values.map((value) => safeDiagnostic(value)).join(' | ').slice(0, 500)
    });
    originalConsoleWarn(...values);
};

window.__AERO_LIVE_NW_SMOKE_STATE__ = {
    stage: 'harness-loaded',
    startedAt: Date.now()
};

const bootstrapPaths = resolveOutputPaths();
fs.writeFileSync(path.join(bootstrapPaths.outputDirectory, 'bootstrap.json'), `${JSON.stringify({
    readyState: document.readyState,
    smokeArgumentRecognized: Array.isArray(nw.App.fullArgv)
        && nw.App.fullArgv.some((argument) => String(argument).startsWith('--aero-live-nw-smoke=')),
    environmentEnabled: nodeProcess.env?.AERO_LIVE_NW_SMOKE === '1'
}, null, 2)}\n`, 'utf8');

if (document.readyState === 'complete') {
    window.setTimeout(() => void runSmoke(), 0);
} else {
    window.addEventListener('load', () => {
        window.setTimeout(() => void runSmoke(), 0);
    }, { once: true });
}
