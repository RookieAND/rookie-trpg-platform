/** 화면 위 사각형(DOMRect에서 필요한 부분만) */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Lane {
  /** 알림 줄의 아래 끝이 화면 아래에서 떨어질 거리(px) */
  bottom: number;
  /** 알림 줄의 가운데 x(px) */
  centerX: number;
  /** 알림 줄이 쓸 수 있는 폭(px) */
  width: number;
}

/**
 * 보드 위에 겹쳐 뜨는 것들의 자리 규칙.
 *  - 알림(토스트)은 보드 아래 가운데에 뜨되, 보드 아래쪽 구석에 놓인 것(되돌리기·선택 줄·표식 막대 등)과 겹치지 않게 그 위로 올린다.
 *  - 휴대폰에서 도구 묶음이 펼쳐져 있으면 그 묶음 위로 올린다.
 * corner는 보드 아래쪽 구석에 놓인 것들(data-lane="bottom")의 사각형이다.
 */
export function toastLane(o: { viewportH: number; board: Box; corner: Box[]; sheetTop?: number | null; gap?: number }): Lane {
  const gap = o.gap ?? 10;
  const boardFloor = o.viewportH - o.board.bottom;
  const sheetFloor = o.sheetTop != null ? o.viewportH - o.sheetTop : 0;
  const cornerH = o.corner.reduce((m, b) => (b.bottom > b.top ? Math.max(m, o.board.bottom - b.top) : m), 0);
  const floor = Math.max(boardFloor + Math.max(0, cornerH), sheetFloor);
  return { bottom: Math.round(floor + gap), centerX: Math.round((o.board.left + o.board.right) / 2), width: Math.round(o.board.right - o.board.left) };
}

/** 두 사각형이 겹치는가(맞닿기만 한 것은 겹침이 아니다) */
export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
