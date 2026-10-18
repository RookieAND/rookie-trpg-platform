/** 보드 단축키를 순수 함수로 판단한다. 실제 동작은 useBoardShortcuts 가 한다. */
export type KeyAction = { type: "delete" } | { type: "duplicate" } | { type: "deselect" } | { type: "cycle"; dir: 1 | -1 };

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

export interface KeyContext {
  /** KP만 지우고 복제할 수 있다(서버도 같은 규칙이다) */
  canEdit: boolean;
  hasSelection: boolean;
  /** 대화상자·메뉴·떠 있는 상자가 열려 있다 */
  overlayOpen: boolean;
}

/** 글을 쓰는 중인 칸인가 */
export function isTyping(target: EventTarget | null): boolean {
  const t = target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = t?.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(t?.isContentEditable);
}

/** 보드 자체(포커스를 받는 svg)가 키를 받았는가 */
export const isBoardTarget = (target: EventTarget | null) => (target as { id?: string } | null)?.id === "game-board";

export function boardKeyAction(e: KeyEventLike, ctx: KeyContext): KeyAction | null {
  if (ctx.overlayOpen || isTyping(e.target)) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (!mod && !e.altKey && !e.shiftKey && (e.key === "Delete" || e.key === "Backspace")) {
    return ctx.canEdit && ctx.hasSelection ? { type: "delete" } : null;
  }
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
    return ctx.canEdit && ctx.hasSelection ? { type: "duplicate" } : null;
  }
  if (e.key === "Escape" && !mod && !e.altKey) return ctx.hasSelection ? { type: "deselect" } : null;
  // Tab은 보드에 포커스가 있고 고른 것이 있을 때만 가로챈다. 고른 것이 없으면 평소처럼 다음 칸으로 넘어가 키보드로 보드를 벗어날 수 있다.
  if (e.key === "Tab" && !mod && !e.altKey && isBoardTarget(e.target) && ctx.hasSelection) return { type: "cycle", dir: e.shiftKey ? -1 : 1 };
  return null;
}

/** 토큰 목록에서 현재 선택의 다음(dir=1)·이전(dir=-1) 토큰. 끝에서는 반대쪽 끝으로 돈다. 토큰이 없으면 null. */
export function nextTokenId(ids: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const i = current ? ids.indexOf(current) : -1;
  if (i < 0) return dir === 1 ? ids[0]! : ids[ids.length - 1]!;
  return ids[(i + dir + ids.length) % ids.length]!;
}

/** 복제본의 자리: 원본에서 오른쪽 아래로 조금 옮기되 보드 밖으로 나가지 않게 한다. */
export const DUP_OFFSET = 40;
export function duplicateSpot(x: number, y: number, w = 1000, h = 800): { x: number; y: number } {
  const dx = x + DUP_OFFSET > w - 20 ? -DUP_OFFSET : DUP_OFFSET;
  const dy = y + DUP_OFFSET > h - 20 ? -DUP_OFFSET : DUP_OFFSET;
  return { x: x + dx, y: y + dy };
}
