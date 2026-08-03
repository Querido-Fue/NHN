/**
 * 일반·핵심 채팅 피드에서 현재 화면에 보이는 행과 사각형을 계산합니다.
 * Scene의 히트박스와 Renderer의 그리기 좌표가 어긋나지 않도록 순수 함수로 공유합니다.
 *
 * @param {object} options - 채팅 행 계산 옵션입니다.
 * @param {Array<object>} [options.chats=[]] - 시간순 전체 채팅입니다.
 * @param {{x:number,y:number,w:number,h:number}} options.rect - 채팅 표시 영역입니다.
 * @param {number} [options.visibleCount=9] - 최대 표시 행 수입니다.
 * @param {number} [options.preferredLineHeight=30] - 목표 행 간격입니다.
 * @returns {Array<{chat:object,index:number,rect:{x:number,y:number,w:number,h:number}}>} 보이는 채팅 행입니다.
 */
export function buildVisibleChatRows({
    chats = [],
    rect,
    visibleCount = 9,
    preferredLineHeight = 30
} = {}) {
    const safeRect = {
        x: Number.isFinite(Number(rect?.x)) ? Number(rect.x) : 0,
        y: Number.isFinite(Number(rect?.y)) ? Number(rect.y) : 0,
        w: Math.max(0, Number.isFinite(Number(rect?.w)) ? Number(rect.w) : 0),
        h: Math.max(0, Number.isFinite(Number(rect?.h)) ? Number(rect.h) : 0)
    };
    const count = Math.max(1, Math.floor(Number(visibleCount) || 1));
    const feed = Array.isArray(chats) ? chats : [];
    const firstVisibleIndex = Math.max(0, feed.length - count);
    const visibleChats = feed.slice(firstVisibleIndex);
    if (visibleChats.length === 0 || safeRect.w <= 0 || safeRect.h <= 0) {
        return [];
    }

    const targetLineHeight = Number(preferredLineHeight) || 0;
    const rowHeight = Math.max(23, Math.min(targetLineHeight, safeRect.h / count));
    const startY = safeRect.y + safeRect.h - visibleChats.length * rowHeight;

    return visibleChats.map((chat, index) => ({
        chat,
        index: firstVisibleIndex + index,
        rect: {
            x: safeRect.x + 3,
            y: startY + index * rowHeight,
            w: Math.max(0, safeRect.w - 6),
            h: Math.max(1, rowHeight - 2)
        }
    }));
}
