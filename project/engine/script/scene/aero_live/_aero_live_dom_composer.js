import { getData } from 'data/data_handler.js';
import { getCanvasOffset, getScaleRatio } from 'display/display_system.js';

const AERO_CONSTANTS = getData('AERO_LIVE_SCENE_CONSTANTS');
const UI = AERO_CONSTANTS.UI;
const COLORS = AERO_CONSTANTS.COLORS;
const FONT_FAMILY = 'Pretendard Variable, arial';

/**
 * AERO LIVE 자유 채팅 form의 생성, Canvas 정렬과 정리를 전담합니다.
 */
export class AeroLiveDomComposer {
    /**
     * @param {{onSubmit?:(message:string)=>void,onEscape?:()=>void}} [options={}] - 입력 동작 콜백입니다.
     */
    constructor(options = {}) {
        this.onSubmit = typeof options.onSubmit === 'function' ? options.onSubmit : () => {};
        this.onEscape = typeof options.onEscape === 'function' ? options.onEscape : () => {};
        this.destroyed = false;
        this.compositionActive = false;
        this.compositionSubmitSuppressed = false;
        this.compositionSuppressionGeneration = 0;
        this.compositionEnterSubmitPending = false;
        this.compositionEnterSubmitGeneration = 0;
        this.#createDom();
    }

    /**
     * 현재 단일 행 입력값을 반환합니다.
     * @returns {string} 입력 원문입니다.
     */
    getValue() {
        return this.input?.value || '';
    }

    /**
     * 전송이 확정된 입력 내용을 비웁니다.
     */
    clear() {
        if (this.input) {
            this.input.value = '';
        }
    }

    /**
     * DOM form을 현재 Canvas 사각형과 입력 상태에 맞춥니다.
     * @param {{rect:{x:number,y:number,w:number,h:number},visible:boolean,disabled:boolean,pending:boolean,messagesRemaining:number,playerName?:string,uiWidth:number,viewportHeight:number}} state - 표시 상태입니다.
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
        const cssPixel = (renderPixels) => `${Math.max(0, renderPixels / scaleRatio)}px`;
        const viewportHeight = Math.max(1, Number(state.viewportHeight) || 720);
        const uiWidth = Math.max(1, Number(state.uiWidth) || 1280);
        const borderRenderPixels = Math.max(1, viewportHeight * 0.0017);

        Object.assign(this.form.style, {
            display: state.visible ? 'grid' : 'none',
            left: `${hostOffsetX + rect.x / scaleRatio}px`,
            top: `${hostOffsetY + rect.y / scaleRatio}px`,
            width: `${rect.w / scaleRatio}px`,
            height: `${rect.h / scaleRatio}px`,
            gridTemplateColumns: `${Math.max(64, rect.w * 0.2) / scaleRatio}px minmax(0, 1fr) ${Math.max(52, uiWidth * UI.DOM_SEND_WIDTH_UIWW / 100) / scaleRatio}px`,
            borderWidth: cssPixel(borderRenderPixels),
            borderRadius: cssPixel(viewportHeight * UI.PANEL_RADIUS_WH / 100),
            boxShadow: [
                `0 ${cssPixel(viewportHeight * 0.012)} ${cssPixel(viewportHeight * 0.032)} ${COLORS.GLASS_SHADOW}`,
                `inset 0 ${cssPixel(borderRenderPixels)} 0 ${COLORS.GLASS_HIGHLIGHT || COLORS.GLASS_BORDER}`,
                `inset 0 -${cssPixel(borderRenderPixels)} 0 ${COLORS.GLASS_INNER_EDGE || COLORS.AQUA}`
            ].join(', ')
        });
        Object.assign(this.maskLabel.style, {
            padding: `0 ${cssPixel(uiWidth * 0.005)}`,
            fontSize: cssPixel(viewportHeight * UI.SMALL_FONT_WH / 100),
            overflow: 'hidden',
            textOverflow: 'ellipsis'
        });
        Object.assign(this.input.style, {
            padding: `0 ${cssPixel(uiWidth * 0.006)}`,
            font: `700 ${cssPixel(viewportHeight * UI.BODY_FONT_WH / 100)} ${FONT_FAMILY}`,
            lineHeight: cssPixel(Math.max(1, rect.h - borderRenderPixels * 2)),
            opacity: state.disabled ? '0.55' : '1'
        });
        Object.assign(this.sendButton.style, {
            font: `900 ${cssPixel(viewportHeight * UI.BODY_FONT_WH / 100)} ${FONT_FAMILY}`,
            cursor: state.disabled ? 'default' : 'pointer',
            opacity: state.disabled ? '0.52' : '1'
        });

        this.input.disabled = state.disabled;
        this.sendButton.disabled = state.disabled;
        this.maskLabel.textContent = String(state.playerName || '플레이어');
        this.input.placeholder = state.pending
            ? 'AI가 의도를 판정하고 있습니다…'
            : (state.messagesRemaining <= 0
                ? '이번 방송의 자유 채팅을 모두 사용했습니다'
                : AERO_CONSTANTS.INPUT.PLACEHOLDER);
    }

    /**
     * form과 연결 참조를 문서에서 완전히 제거합니다.
     */
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
        this.maskLabel = null;
        this.input = null;
        this.sendButton = null;
        this.compositionActive = false;
        this.compositionSubmitSuppressed = false;
        this.compositionSuppressionGeneration += 1;
        this.compositionEnterSubmitPending = false;
        this.compositionEnterSubmitGeneration += 1;
        this.onSubmit = () => {};
        this.onEscape = () => {};
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

    /** 한글 조합을 끝낸 Enter를 조합 종료 직후 한 번만 전송합니다. @private */
    #queueCompositionEnterSubmit() {
        this.compositionEnterSubmitPending = true;
        this.compositionEnterSubmitGeneration += 1;
        const generation = this.compositionEnterSubmitGeneration;
        const schedule = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
            ? window.setTimeout.bind(window)
            : setTimeout;
        schedule(() => {
            if (this.destroyed
                || generation !== this.compositionEnterSubmitGeneration
                || this.compositionActive
                || !this.compositionEnterSubmitPending) {
                return;
            }
            this.compositionEnterSubmitPending = false;
            this.compositionSubmitSuppressed = false;
            this.onSubmit(this.getValue());
        }, 0);
    }

    /**
     * form, 단일 행 입력과 전송 버튼을 생성해 문서에 연결합니다.
     * @private
     */
    #createDom() {
        this.host = typeof document.getElementById === 'function'
            ? (document.getElementById('overlaylayerhost') || document.body)
            : document.body;
        this.form = document.createElement('form');
        this.form.className = 'aero-live-composer';
        this.form.setAttribute('aria-label', 'AERO LIVE 자유 채팅 입력');
        Object.assign(this.form.style, {
            position: 'absolute',
            zIndex: '2',
            display: 'none',
            gridTemplateColumns: 'auto minmax(0, 1fr) auto',
            alignItems: 'stretch',
            boxSizing: 'border-box',
            overflow: 'hidden',
            pointerEvents: 'auto',
            background: 'linear-gradient(180deg, rgba(14,57,84,0.62), rgba(7,35,59,0.44))',
            backdropFilter: 'blur(18px) saturate(145%)',
            WebkitBackdropFilter: 'blur(18px) saturate(145%)',
            borderStyle: 'solid',
            borderColor: COLORS.GLASS_BORDER,
            fontFamily: FONT_FAMILY
        });

        this.maskLabel = document.createElement('span');
        this.maskLabel.textContent = '플레이어';
        Object.assign(this.maskLabel.style, {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
            color: COLORS.AQUA,
            background: 'linear-gradient(135deg, rgba(66,224,208,0.2), rgba(154,133,255,0.14))',
            whiteSpace: 'nowrap',
            fontWeight: '800'
        });

        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.maxLength = AERO_CONSTANTS.AI.PLAYER_MESSAGE_MAX_CHARS;
        this.input.placeholder = AERO_CONSTANTS.INPUT.PLACEHOLDER;
        this.input.autocomplete = 'off';
        this.input.enterKeyHint = 'send';
        this.input.setAttribute('aria-label', AERO_CONSTANTS.INPUT.PLACEHOLDER);
        Object.assign(this.input.style, {
            display: 'block',
            border: '0',
            outline: 'none',
            minWidth: '0',
            minHeight: '0',
            maxWidth: '100%',
            width: '100%',
            alignSelf: 'stretch',
            boxSizing: 'border-box',
            color: COLORS.GLASS_WHITE,
            caretColor: COLORS.AQUA,
            background: 'rgba(5,27,43,0.4)',
            lineHeight: 'normal',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            appearance: 'none'
        });

        this.sendButton = document.createElement('button');
        this.sendButton.type = 'submit';
        this.sendButton.textContent = AERO_CONSTANTS.INPUT.SEND_LABEL;
        this.sendButton.setAttribute('aria-label', '자유 채팅 전송');
        Object.assign(this.sendButton.style, {
            border: '0',
            outline: 'none',
            color: COLORS.INK,
            background: 'linear-gradient(180deg, #79F5E7 0%, #42E0D0 55%, #33CDBF 100%)',
            boxShadow: `inset 0 1px 0 ${COLORS.GLASS_HIGHLIGHT || COLORS.GLASS_WHITE}, 0 0 18px rgba(66,224,208,0.2)`,
            fontWeight: '900',
            cursor: 'pointer'
        });

        this.form.append(this.maskLabel, this.input, this.sendButton);
        for (const eventName of ['mousedown', 'mouseup', 'click']) {
            this.form.addEventListener(eventName, (event) => {
                event.stopPropagation();
            });
        }
        this.form.addEventListener('submit', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (this.compositionActive
                || this.compositionSubmitSuppressed
                || this.compositionEnterSubmitPending) {
                this.#queueCompositionEnterSubmit();
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
            if (this.compositionEnterSubmitPending) {
                this.#queueCompositionEnterSubmit();
            }
        });
        this.input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                if (event.isComposing
                    || this.compositionActive
                    || event.keyCode === 229) {
                    this.#suppressCompositionSubmit();
                    this.#queueCompositionEnterSubmit();
                    event.stopPropagation();
                    return;
                }
                this.compositionEnterSubmitPending = false;
                this.compositionEnterSubmitGeneration += 1;
                this.compositionSubmitSuppressed = false;
                event.preventDefault();
                event.stopPropagation();
                if (!event.shiftKey) {
                    this.onSubmit(this.getValue());
                }
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.onEscape();
            }
        });
        this.host.appendChild(this.form);
    }
}
