import { initializeGameRuntime } from './game_main.js';

const nwArguments = Array.isArray(globalThis.window?.nw?.App?.fullArgv)
    ? globalThis.window.nw.App.fullArgv
    : [];
let aeroLiveSmokeEnvironmentEnabled = false;
try {
    aeroLiveSmokeEnvironmentEnabled = globalThis.window?.require?.('process')
        ?.env?.AERO_LIVE_NW_SMOKE === '1';
} catch (error) {
    aeroLiveSmokeEnvironmentEnabled = false;
}
const aeroLiveSmokeEnabled = aeroLiveSmokeEnvironmentEnabled || nwArguments.some((argument) => {
    return /^--aero-live-nw-smoke=[a-z0-9][a-z0-9-]{0,47}$/u.test(String(argument));
});

if (aeroLiveSmokeEnabled) {
    await import('./smoke/aero_live_nw_smoke_harness.js');
}

const startGameRuntime = () => {
    const smokeState = globalThis.window?.__AERO_LIVE_NW_SMOKE_STATE__;
    if (smokeState) {
        smokeState.stage = 'initialize-called';
    }
    void initializeGameRuntime();
};

if (document.readyState === 'complete') {
    startGameRuntime();
} else {
    window.addEventListener('load', () => {
        startGameRuntime();
    }, { once: true });
}
