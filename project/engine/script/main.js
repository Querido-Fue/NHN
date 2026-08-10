import { initializeGameRuntime } from './game_main.js';
import {
    completeRuntimeLoading,
    preloadRuntimeAssets,
    showRuntimeLoadingError
} from './runtime/runtime_asset_preloader.js';

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const startGameRuntime = async () => {
    try {
        await preloadRuntimeAssets();
        const gameApp = await initializeGameRuntime();
        if (!gameApp) {
            showRuntimeLoadingError('게임을 시작하지 못했습니다. 페이지를 새로고침해 주세요.');
            return;
        }
        await nextFrame();
        completeRuntimeLoading();
    } catch (error) {
        console.warn('게임 리소스 사전 로드 중 오류가 발생했습니다.', error);
        showRuntimeLoadingError('리소스를 불러오지 못했습니다. 페이지를 새로고침해 주세요.');
    }
};

void startGameRuntime();
