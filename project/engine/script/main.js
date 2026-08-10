import { initializeGameRuntime } from './game_main.js';

const startGameRuntime = () => {
    void initializeGameRuntime();
};

if (document.readyState === 'complete') {
    startGameRuntime();
} else {
    window.addEventListener('load', startGameRuntime, { once: true });
}
