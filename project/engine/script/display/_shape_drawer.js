/** 기본 도형이 셀 안에서 차지하는 반지름 비율입니다. */
const BASE_SHAPE_RADIUS_RATIO = 0.45;
/** 원형과 다각형 경로를 닫는 라디안 값입니다. */
const FULL_CIRCLE_RADIANS = Math.PI * 2;
/** 다각형 첫 꼭짓점을 위쪽으로 맞추는 라디안 오프셋입니다. */
const UPRIGHT_POLYGON_ANGLE_OFFSET = -Math.PI / 2;
/** 화살표 외곽 꼭짓점이 반지름에서 차지하는 비율입니다. */
const ARROW_OUTER_POINT_RATIO = 0.7;
/** 화살표 안쪽 접점이 반지름에서 차지하는 비율입니다. */
const ARROW_INNER_POINT_RATIO = 0.3;

/**
 * @class ShapeDrawer
 * @description 엔진 기본 도형을 캔버스 컨텍스트에 그립니다.
 */
export class ShapeDrawer {
    /**
     * 범용 도형을 화면에 렌더링합니다.
     * @param {CanvasRenderingContext2D} ctx - 렌더링 컨텍스트입니다.
     * @param {string} shape - 그릴 대상 형태의 식별 문자열입니다.
     * @param {number} ox - 도형의 x좌표 시작점입니다.
     * @param {number} oy - 도형의 y좌표 시작점입니다.
     * @param {number} size - 도형 크기 매개변수입니다.
     */
    drawShape(ctx, shape, ox, oy, size) {
        const half = size / 2;
        const cx = ox + half;
        const cy = oy + half;
        const radius = size * BASE_SHAPE_RADIUS_RATIO;

        switch (shape) {
            case 'rect':
            case 'square':
                ctx.fillRect(ox, oy, size, size);
                break;
            case 'circle':
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, FULL_CIRCLE_RADIANS);
                ctx.fill();
                break;
            case 'triangle':
                this.#drawPolygon(ctx, cx, cy, radius, 3);
                break;
            case 'pentagon':
                this.#drawPolygon(ctx, cx, cy, radius, 5);
                break;
            case 'hexagon':
                this.#drawPolygon(ctx, cx, cy, radius, 6);
                break;
            case 'octagon':
                this.#drawPolygon(ctx, cx, cy, radius, 8);
                break;
            case 'arrow':
                this.#drawArrow(ctx, cx, cy, radius);
                break;
            default:
                ctx.fillRect(ox, oy, size, size);
                break;
        }
    }

    /**
     * 임의의 변 개수를 가진 다각형(삼각형, 오각형 등)을 그립니다.
     * @param {CanvasRenderingContext2D} ctx - 렌더링 컨텍스트입니다.
     * @param {number} x - 중심 x좌표입니다.
     * @param {number} y - 중심 y좌표입니다.
     * @param {number} radius - 다각형 반지름 길이입니다.
     * @param {number} sides - 구성 변의 개수입니다.
     * @private
     */
    #drawPolygon(ctx, x, y, radius, sides) {
        const angleStep = FULL_CIRCLE_RADIANS / sides;
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const angle = UPRIGHT_POLYGON_ANGLE_OFFSET + i * angleStep;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            if (i === 0) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.closePath();
        ctx.fill();
    }

    /**
     * 지시용 화살표 형태를 화면에 그립니다.
     * @param {CanvasRenderingContext2D} ctx - 렌더링 컨텍스트입니다.
     * @param {number} x - 중심 x좌표입니다.
     * @param {number} y - 중심 y좌표입니다.
     * @param {number} radius - 형태 반경 크기입니다.
     * @private
     */
    #drawArrow(ctx, x, y, radius) {
        const outerPoint = radius * ARROW_OUTER_POINT_RATIO;
        const innerPoint = radius * ARROW_INNER_POINT_RATIO;

        ctx.beginPath();
        ctx.moveTo(x - outerPoint, y + outerPoint);
        ctx.lineTo(x, y - outerPoint);
        ctx.lineTo(x + outerPoint, y + outerPoint);
        ctx.lineTo(x, y + innerPoint);
        ctx.closePath();
        ctx.fill();
    }
}
