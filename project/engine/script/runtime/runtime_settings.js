import { getData } from 'data/data_handler.js';
import { setTheme } from 'display/_theme_handler.js';
import { LANGUAGE_REGISTRY } from 'ui/lang/_language_registry.js';

const THEME_KEYS = getData('THEME_KEYS');
const DEFAULT_THEME_KEY = getData('DEFAULT_THEME_KEY');
const AVAILABLE_LANGUAGE_KEYS = Object.keys(LANGUAGE_REGISTRY);
const FALLBACK_LANGUAGE_KEY = AVAILABLE_LANGUAGE_KEYS.includes('english')
    ? 'english'
    : (AVAILABLE_LANGUAGE_KEYS[0] || 'korean');

let runtimeSettingsInstance = null;

/**
 * 브라우저 실행 중에만 설정을 보관합니다. 모든 값은 새로고침이나 탭 종료 때 초기값으로 돌아가며,
 * 파일·브라우저 저장소·네트워크에는 기록하지 않습니다.
 */
export class RuntimeSettings {
    constructor() {
        runtimeSettingsInstance = this;
        const language = typeof navigator !== 'undefined'
            && String(navigator.language || '').startsWith('ko')
            && AVAILABLE_LANGUAGE_KEYS.includes('korean')
            ? 'korean'
            : FALLBACK_LANGUAGE_KEY;
        this.schema = {
            theme: { type: 'string', value: DEFAULT_THEME_KEY, min: -1, max: -1 },
            disableTransparency: { type: 'bool', value: false, min: -1, max: -1 },
            language: { type: 'string', value: language, min: -1, max: -1 },
            renderScale: { type: 'int', value: 100, min: 75, max: 100 },
            uiScale: { type: 'int', value: 100, min: 75, max: 150 },
            tooltipDelaySeconds: { type: 'float', value: 0.7, min: 0, max: 2 },
            bgmVolume: { type: 'int', value: 100, min: 0, max: 100 },
            sfxVolume: { type: 'int', value: 100, min: 0, max: 100 },
            debugMode: { type: 'bool', value: false, min: -1, max: -1 }
        };
    }

    /** 비영속 설정은 이미 기본값으로 준비되어 있으므로 초기화할 작업이 없습니다. */
    async init() {
        setTheme(this.getSetting('theme'));
    }

    getSetting(key) {
        return this.schema[key]?.value;
    }

    getSchema(key) {
        const entry = this.schema[key];
        return entry ? { ...entry } : undefined;
    }

    setSetting(key, value) {
        this.#apply({ [key]: value });
        return Promise.resolve();
    }

    setSettingBatch(settings) {
        this.#apply(settings);
        return Promise.resolve();
    }

    previewSettingBatch(settings) {
        this.#apply(settings);
    }

    #apply(settings) {
        if (!settings || typeof settings !== 'object') return;
        for (const [key, value] of Object.entries(settings)) {
            const entry = this.schema[key];
            if (!entry) continue;
            entry.value = this.#normalize(key, value, entry);
        }
        if (Object.prototype.hasOwnProperty.call(settings, 'theme')) {
            setTheme(this.getSetting('theme'));
        }
    }

    #normalize(key, value, entry) {
        if (entry.type === 'bool') return value === true;
        if (entry.type === 'string') {
            const text = String(value || '');
            if (key === 'theme') return THEME_KEYS.includes(text) ? text : DEFAULT_THEME_KEY;
            if (key === 'language') return AVAILABLE_LANGUAGE_KEYS.includes(text) ? text : FALLBACK_LANGUAGE_KEY;
            return text;
        }
        const parsed = entry.type === 'int' ? Number.parseInt(value, 10) : Number.parseFloat(value);
        if (!Number.isFinite(parsed)) return entry.value;
        const minimum = Number.isFinite(entry.min) && entry.min >= 0 ? entry.min : -Infinity;
        const maximum = Number.isFinite(entry.max) && entry.max >= 0 ? entry.max : Infinity;
        const bounded = Math.min(maximum, Math.max(minimum, parsed));
        if (key === 'tooltipDelaySeconds') return Number(bounded.toFixed(1));
        return entry.type === 'int' ? Math.round(bounded) : bounded;
    }
}

export const getSetting = (key) => runtimeSettingsInstance?.getSetting(key);
export const setSetting = (key, value) => runtimeSettingsInstance?.setSetting(key, value) || Promise.resolve();
export const setSettingBatch = (settings) => runtimeSettingsInstance?.setSettingBatch(settings) || Promise.resolve();
export const previewSettingBatch = (settings) => runtimeSettingsInstance?.previewSettingBatch(settings);
export const getSettingSchema = (key) => runtimeSettingsInstance?.getSchema(key);
export const getRuntimeSettingsInstance = () => runtimeSettingsInstance;
