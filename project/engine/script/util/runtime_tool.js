let runtimeToolInstance = null;

/**
 * 브라우저 런타임의 링크·전체화면 요청을 정리합니다.
 * 데스크톱 창 제어와 파일 시스템은 사용하지 않습니다.
 */
export class RuntimeTool {
    constructor() {
        runtimeToolInstance = this;
        this._externalURLHandler = null;
    }

    setExternalURLHandler(handler) {
        this._externalURLHandler = typeof handler === 'function' ? handler : null;
    }

    openURL(url) {
        const normalizedUrl = typeof url === 'string' ? url.trim() : '';
        if (!normalizedUrl) return false;
        const handled = this._externalURLHandler?.(normalizedUrl);
        if (handled !== null && handled !== undefined && handled !== false) return handled;
        const opened = window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
        return opened !== null;
    }

    async setFullScreen(enabled) {
        try {
            if (enabled && document.documentElement.requestFullscreen) {
                await document.documentElement.requestFullscreen();
            } else if (!enabled && document.fullscreenElement && document.exitFullscreen) {
                await document.exitFullscreen();
            }
            return true;
        } catch {
            return false;
        }
    }

    setWindowSize() {}

    setWindowPosition() {}

    setWindowPositionCenter() {}

    setZoomLevel() {}

    closeWindow() {
        window.close();
    }
}

export function runtimeTool() {
    return runtimeToolInstance;
}
