/** 장면 탭을 끌어 순서를 바꿀 때 쓰는 계산. 화면과 상관없는 순수 함수라 따로 시험한다. */

/** 끌어 온 탭이 놓일 쪽: 대상 탭의 앞(왼쪽) 또는 뒤(오른쪽) */
export type DropSide = "before" | "after";

/** 대상 탭 안에서 커서가 왼쪽 절반이면 앞, 오른쪽 절반이면 뒤 */
export function dropSide(clientX: number, rect: { left: number; width: number }): DropSide {
  return clientX < rect.left + rect.width / 2 ? "before" : "after";
}

/**
 * `from`번째 장면을 `target`번째 장면의 앞/뒤에 놓을 때, 옮긴 뒤 그 장면의 자리(index).
 * 서버의 `scene.reorder`가 받는 값과 같다. 자리가 그대로면 null(보낼 필요 없음).
 */
export function reorderTarget(from: number, target: number, side: DropSide, count: number): number | null {
  if (!Number.isInteger(from) || !Number.isInteger(target) || from < 0 || target < 0 || from >= count || target >= count) return null;
  const insertAt = target + (side === "after" ? 1 : 0); // 옮기기 전 배열에서 끼워 넣을 자리
  const final = insertAt > from ? insertAt - 1 : insertAt; // 자기 자신을 빼고 나면 한 칸 당겨진다
  return final === from ? null : final;
}

/** 놓기 표시(세로 줄)를 어느 탭의 어느 쪽에 그릴지. 같은 자리가 되는 곳에는 그리지 않는다. */
export function dropIndicator(from: number, target: number, side: DropSide, count: number): { index: number; side: DropSide } | null {
  return reorderTarget(from, target, side, count) === null ? null : { index: target, side };
}
