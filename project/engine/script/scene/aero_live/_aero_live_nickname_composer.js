import { getData } from 'data/data_handler.js';
import { getCanvasOffset, getScaleRatio } from 'display/display_system.js';
import { AERO_LIVE_PLAYER_NAME_MAX_CHARS } from './_aero_live_player_identity.mjs';

const AERO_CONSTANTS = getData('AERO_LIVE_SCENE_CONSTANTS');
const UI = AERO_CONSTANTS.UI;
const COLORS = AERO_CONSTANTS.COLORS;
const FONT_FAMILY = 'Pretendard Variable, arial';

/**
 * 프로토타입 시작 시 플레이어 닉네임을 받는 단일 행 DOM form입니다.
 */
export class AeroLiveNicknameComposer {
    /**
     * @param {{onSubmit?:(name:string)=>void}} [options={}] - 닉네임 확정 콜백입니다.
     */
    constructor(options = {}) {
        this.onSubmit = typeof options.onSubmit === 'function' ? options.onSubmit : () => {};
        this.destroyed = false;
        this.visible = false;
        this.compositionActive = false;
        this.compositionSubmitSuppressed = false;
        this.compositionSuppressionGeneration = 0;
        this.#createDom();
    }

    /** @returns {string} 현재 입력한 닉네임 원문입니다. */
    getValue() {
        return this.input?.value || '';
    }

    /** 닉네임 입력 칸으로 키보드 포커스를 이동합니다. */
    focus() {
        this.input?.focus?.();
        this.input?.select?.();
    }

    /**
     * Canvas 모달의 입력 영역과 DOM form을 정렬합니다.
     * @param {{rect:{x:number,y:number,w:number,h:number},visible:boolean,invalid?:boolean,uiWidth:number,viewportHeight:number}} state - 표시 상태입니다.
     */
    sync(state) {
        if (this.destroyed || !this.form || !state?.rect) {
            return;
        }

        const rect = state.rect;
        const scaleRatio = Math.max(0.0001, getScaleRatio());
        const canvasOffset = getCanvasOffset();
        const insideOverlayHost = this.host?.id === 'overlaylayerhost';
        const hostOffsetX = insideOverlayHost ? 0 : canvasOffset.x;
        const hostOffsetY = insideOverlayHost ? 0 : canvasOffset.y;
        const viewportHeight = Math.max(1, Number(state.viewportHeight) || 720);
        const uiWidth = Math.max(1, Number(state.uiWidth) || 1280);
        const borderPixels = Math.max(1, viewportHeight * 0.0022);
        const cssPixel = (renderPixels) => `${Math.max(0, renderPixels / scaleRatio)}px`;
        const nextVisible = state.visible === true;

        Object.assign(this.form.style, {
            display: nextVisible ? 'grid' : 'none',
            left: `${hostOffsetX + rect.x / scaleRatio}px`,
            top: `${hostOffsetY + rect.y / scaleRatio}px`,
            width: `${rect.w / scaleRatio}px`,
            height: `${rect.h / scaleRatio}px`,
            gridTemplateColumns: `minmax(0, 1fr) ${Math.max(86, uiWidth * 0.085) / scaleRatio}px`,
            borderWidth: cssPixel(borderPixels),
            borderRadius: cssPixel(viewportHeight * UI.PANEL_RADIUS_WH / 100),
            borderColor: state.invalid ? COLORS.NEGATIVE : COLORS.AQUA,
            boxShadow: `0 ${cssPixel(viewportHeight * 0.008)} ${cssPixel(viewportHeight * 0.024)} ${COLORS.GLASS_SHADOW}`
        });
        Object.assign(this.input.style, {
            padding: `0 ${cssPixel(uiWidth * 0.014)}`,
            font: `800 ${cssPixel(viewportHeight * UI.BODY_FONT_WH / 100 * 1.08)} ${FONT_FAMILY}`,
            lineHeight: cssPixel(Math.max(1, rect.h - borderPixels * 2))
        });
        Object.assign(this.submitButton.style, {
            font: `900 ${cssPixel(viewportHeight * UI.BODY_FONT_WH / 100)} ${FONT_FAMILY}`
        });

        if (nextVisible && !this.visible) {
            const focusInput = () => {
                if (!this.destroyed && this.visible) {
                    this.focus();
                }
            };
            if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
                window.requestAnimationFrame(focusInput);
            } else {
                focusInput();
            }
        }
        this.visible = nextVisible;
    }

    /** form과 콜백 참조를 완전히 정리합니다. */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        if (this.form?.parentNode) {
            this.form.parentNode.removeChild(this.form);
        }
        this.form = null;
        this.host = null;
        this.input = null;
        this.submitButton = null;
        this.compositionActive = false;
        this.compositionSubmitSuppressed = false;
        this.compositionSuppressionGeneration += 1;
        this.onSubmit = () => {};
    }

    /** IME 확정 이벤트와 같은 macrotask의 form 제출을 한 번 억제합니다. @private */
    #suppressCompositionSubmit() {
        this.compositionSubmitSuppressed = true;
        this.compositionSuppressionGeneration += 1;
        const generation = this.compositionSuppressionGeneration;
        const schedule = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
            ? window.setTimeout.bind(window)
            : setTimeout;
        schedule(() => {
            if (!this.destroyed && generation === this.compositionSuppressionGeneration) {
                this.compositionSubmitSuppressed = false;
            }
        }, 0);
    }

    /** form, 입력과 확정 버튼을 문서에 연결합니다. @private */
    #createDom() {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
            return;
        }
        this.host = typeof document.getElementById === 'function'
            ? (document.getElementById('overlaylayerhost') || document.body)
            : document.body;
        if (!this.host) {
            return;
        }

        this.form = document.createElement('form');
        this.form.className = 'aero-live-nickname-composer';
        this.form.setAttribute('aria-label', 'I Can Fix Her! 플레이어 닉네임 설정');
        Object.assign(this.form.style, {
            position: 'absolute',
            zIndex: '3',
            display: 'none',
            alignItems: 'stretch',
            boxSizing: 'border-box',
            overflow: 'hidden',
            pointerEvents: 'auto',
            background: 'linear-gradient(180deg, rgba(14,57,84,0.78), rgba(7,35,59,0.68))',
            backdropFilter: 'blur(22px) saturate(150%)',
            WebkitBackdropFilter: 'blur(22px) saturate(150%)',
            borderStyle: 'solid',
            fontFamily: FONT_FAMILY
        });

        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.maxLength = AERO_LIVE_PLAYER_NAME_MAX_CHARS;
        this.input.placeholder = '방송에서 사용할 닉네임';
        this.input.autocomplete = 'off';
        this.input.spellcheck = false;
        this.input.enterKeyHint = 'done';
        this.input.setAttribute('aria-label', '플레이어 닉네임');
        Object.assign(this.input.style, {
            display: 'block',
            minWidth: '0',
            width: '100%',
            boxSizing: 'border-box',
            border: '0',
            outline: 'none',
            color: COLORS.GLASS_WHITE,
            caretColor: COLORS.AQUA,
            background: 'rgba(5,27,43,0.34)',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            appearance: 'none'
        });

        this.submitButton = document.createElement('button');
        this.submitButton.type = 'submit';
        this.submitButton.textContent = '시작하기';
        this.submitButton.setAttribute('aria-label', '닉네임 확정');
        Object.assign(this.submitButton.style, {
            border: '0',
            outline: 'none',
            color: COLORS.INK,
            background: 'linear-gradient(180deg, #79F5E7 0%, #42E0D0 55%, #33CDBF 100%)',
            boxShadow: `inset 0 1px 0 ${COLORS.GLASS_HIGHLIGHT || COLORS.GLASS_WHITE}`,
            cursor: 'pointer',
            fontWeight: '900'
        });

        this.form.append(this.input, this.submitButton);
        for (const eventName of ['mousedown', 'mouseup', 'click']) {
            this.form.addEventListener(eventName, (event) => {
                event.stopPropagation();
            });
        }
        this.form.addEventListener('submit', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (this.compositionActive || this.compositionSubmitSuppressed) {
                return;
            }
            this.onSubmit(this.getValue());
        });
        this.input.addEventListener('compositionstart', () => {
            this.compositionActive = true;
        });
        this.input.addEventListener('compositionend', () => {
            this.compositionActive = false;
            this.#suppressCompositionSubmit();
        });
        this.input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') {
                return;
            }
            if (event.isComposing
                || this.compositionActive
                || event.keyCode === 229
                || this.compositionSubmitSuppressed) {
                this.#suppressCompositionSubmit();
                event.stopPropagation();
                return;
            }
            this.compositionSubmitSuppressed = false;
            event.preventDefault();
            event.stopPropagation();
            this.onSubmit(this.getValue());
        });
        this.host.appendChild(this.form);
    }
}
