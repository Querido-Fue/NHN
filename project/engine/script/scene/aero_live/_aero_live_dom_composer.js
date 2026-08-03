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
     * @param {{rect:{x:number,y:number,w:number,h:number},visible:boolean,disabled:boolean,pending:boolean,messagesRemaining:number,uiWidth:number,viewportHeight:number}} state - 표시 상태입니다.
     */
    sync(state) {
        if (this.destroyed || !this.form || !state?.rect) {
            return;
        }

        const rect = state.rect;
        const scaleRatio = Math.max(0.0001, getScaleRatio());
        const canvasOffset = getCanvasOffset();
        const cssPixel = (renderPixels) => `${Math.max(0, renderPixels / scaleRatio)}px`;
        const viewportHeight = Math.max(1, Number(state.viewportHeight) || 720);
        const uiWidth = Math.max(1, Number(state.uiWidth) || 1280);
        const borderRenderPixels = Math.max(1, viewportHeight * 0.0017);

        Object.assign(this.form.style, {
            display: state.visible ? 'grid' : 'none',
            left: `${canvasOffset.x + rect.x / scaleRatio}px`,
            top: `${canvasOffset.y + rect.y / scaleRatio}px`,
            width: `${rect.w / scaleRatio}px`,
            height: `${rect.h / scaleRatio}px`,
            gridTemplateColumns: `${Math.max(64, rect.w * 0.2) / scaleRatio}px minmax(0, 1fr) ${Math.max(52, uiWidth * UI.DOM_SEND_WIDTH_UIWW / 100) / scaleRatio}px`,
            borderWidth: cssPixel(borderRenderPixels),
            borderRadius: cssPixel(viewportHeight * UI.PANEL_RADIUS_WH / 100),
            boxShadow: `0 ${cssPixel(viewportHeight * 0.008)} ${cssPixel(viewportHeight * 0.02)} ${COLORS.GLASS_SHADOW}`
        });
        Object.assign(this.maskLabel.style, {
            padding: `0 ${cssPixel(uiWidth * 0.005)}`,
            fontSize: cssPixel(viewportHeight * UI.SMALL_FONT_WH / 100)
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
        this.maskLabel = null;
        this.input = null;
        this.sendButton = null;
        this.onSubmit = () => {};
        this.onEscape = () => {};
    }

    /**
     * form, 단일 행 입력과 전송 버튼을 생성해 문서에 연결합니다.
     * @private
     */
    #createDom() {
        this.form = document.createElement('form');
        this.form.className = 'aero-live-composer';
        this.form.setAttribute('aria-label', 'AERO LIVE 자유 채팅 입력');
        Object.assign(this.form.style, {
            position: 'absolute',
            zIndex: '55',
            display: 'none',
            gridTemplateColumns: 'auto minmax(0, 1fr) auto',
            alignItems: 'stretch',
            boxSizing: 'border-box',
            overflow: 'hidden',
            pointerEvents: 'auto',
            background: COLORS.DARK_GLASS,
            borderStyle: 'solid',
            borderColor: COLORS.GLASS_BORDER,
            fontFamily: FONT_FAMILY
        });

        this.maskLabel = document.createElement('span');
        this.maskLabel.textContent = AERO_CONSTANTS.INPUT.MASK_LABEL;
        Object.assign(this.maskLabel.style, {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
            color: COLORS.AQUA,
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
            background: 'rgba(5,27,43,0.68)',
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
            background: COLORS.AQUA,
            fontWeight: '900',
            cursor: 'pointer'
        });

        this.form.append(this.maskLabel, this.input, this.sendButton);
        this.form.addEventListener('submit', (event) => {
            event.preventDefault();
            this.onSubmit(this.getValue());
        });
        this.input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                if (event.isComposing) {
                    return;
                }
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
        document.body.appendChild(this.form);
    }
}
