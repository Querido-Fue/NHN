import { AERO_LIVE_SCENE_CONSTANTS } from '../data/scene/aero_live/aero_live_scene_constants.js';

const AERO_ASSETS = AERO_LIVE_SCENE_CONSTANTS.ASSET || {};
const AERO_WALLPAPER = AERO_ASSETS.WALLPAPER || {};

const IMAGE_PATHS = Object.freeze([
    AERO_ASSETS.TOPIC_SELECT_ARTWORK?.PATH,
    AERO_WALLPAPER.BASE_PATH,
    AERO_WALLPAPER.NORMAL_PATH,
    AERO_WALLPAPER.WATER_MASK_PATH,
    AERO_WALLPAPER.CURSOR_MASK_PATH,
    AERO_ASSETS.LIVE_STAGE_BACKGROUND_PATH,
    AERO_ASSETS.DONATION_ALERT_GIF_PATH,
    ...Object.values(AERO_ASSETS.HERO_POSE_PATHS || {})
].filter((path, index, paths) => typeof path === 'string' && path && paths.indexOf(path) === index));

const FONT_LOADS = Object.freeze(['16px "Pretendard Variable"']);

function getLoadingElements() {
    return {
        root: document.getElementById('loading-screen'),
        message: document.getElementById('loading-message'),
        progress: document.querySelector('.loading-progress-track'),
        progressBar: document.getElementById('loading-progress-bar'),
        progressText: document.getElementById('loading-progress-text')
    };
}

function updateProgress(completed, total, message) {
    const ratio = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 1;
    const percent = Math.round(ratio * 100);
    const elements = getLoadingElements();
    if (elements.message && message) elements.message.textContent = message;
    if (elements.progress) elements.progress.setAttribute('aria-valuenow', String(percent));
    if (elements.progressBar) elements.progressBar.style.width = `${percent}%`;
    if (elements.progressText) elements.progressText.textContent = `${percent}%`;
}

function preloadImage(path) {
    return new Promise((resolve) => {
        const image = new Image();
        image.decoding = 'async';
        const settle = async (ok) => {
            if (ok && typeof image.decode === 'function') {
                try {
                    await image.decode();
                } catch {
                    // 애니메이션 GIF 등 decode()를 지원하지 않는 리소스는 load 완료 상태를 사용합니다.
                }
            }
            resolve({ path, ok });
        };
        image.onload = () => { void settle(true); };
        image.onerror = () => { void settle(false); };
        image.src = path;
    });
}

async function preloadFont(font) {
    if (!document.fonts?.load) return { font, ok: true };
    try {
        await document.fonts.load(font);
        return { font, ok: true };
    } catch {
        return { font, ok: false };
    }
}

/** 게임 화면 전환 전에 현재 배포본이 사용하는 이미지와 웹폰트를 병렬로 준비합니다. */
export async function preloadRuntimeAssets() {
    const tasks = [
        ...IMAGE_PATHS.map((path) => () => preloadImage(path)),
        ...FONT_LOADS.map((font) => () => preloadFont(font))
    ];
    const total = tasks.length;
    let completed = 0;
    let failed = 0;
    updateProgress(0, total, '방송 리소스를 준비하고 있습니다.');

    await Promise.all(tasks.map(async (task) => {
        const result = await task();
        if (!result.ok) failed += 1;
        completed += 1;
        updateProgress(completed, total, `방송 리소스 ${completed}/${total} 준비 중`);
    }));

    updateProgress(total, total, failed > 0
        ? '일부 선택 리소스를 불러오지 못했습니다. 대체 화면으로 시작합니다.'
        : '방송 준비를 마쳤습니다.');
    return { total, failed };
}

/** 첫 렌더 프레임 이후 로딩 화면을 부드럽게 제거합니다. */
export function completeRuntimeLoading() {
    const { root } = getLoadingElements();
    if (!root) return;
    root.classList.add('is-complete');
    window.setTimeout(() => root.remove(), 240);
}

/** 초기화 자체에 실패했을 때 사용자가 화면을 새로고침할 수 있도록 로딩 화면을 유지합니다. */
export function showRuntimeLoadingError(message) {
    const elements = getLoadingElements();
    if (elements.message) elements.message.textContent = message;
    if (elements.progressText) elements.progressText.textContent = '재시도 필요';
    if (elements.progress) elements.progress.setAttribute('aria-valuetext', '초기화 실패');
}
