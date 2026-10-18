import { describe, expect, it } from "vitest";
import { boardKeyAction, duplicateSpot, nextTokenId, type KeyContext, type KeyEventLike } from "./shortcuts";

const target = (o: { tagName?: string; id?: string; isContentEditable?: boolean } = {}) => ({ tagName: "DIV", ...o }) as unknown as EventTarget;
const ev = (key: string, o: Partial<KeyEventLike> = {}): KeyEventLike => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: target(), ...o });
const ctx = (o: Partial<KeyContext> = {}): KeyContext => ({ canEdit: true, hasSelection: true, overlayOpen: false, ...o });

describe("boardKeyAction: 지우기", () => {
  it("선택이 있으면 Delete·Backspace 로 지운다", () => {
    expect(boardKeyAction(ev("Delete"), ctx())).toEqual({ type: "delete" });
    expect(boardKeyAction(ev("Backspace"), ctx())).toEqual({ type: "delete" });
  });
  it("선택이 없거나 KP가 아니면 무시", () => {
    expect(boardKeyAction(ev("Delete"), ctx({ hasSelection: false }))).toBeNull();
    expect(boardKeyAction(ev("Delete"), ctx({ canEdit: false }))).toBeNull();
  });
  it("글을 쓰는 중이거나 대화상자·메뉴가 열려 있으면 무시", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(boardKeyAction(ev("Backspace", { target: target({ tagName }) }), ctx())).toBeNull();
    expect(boardKeyAction(ev("Backspace", { target: target({ isContentEditable: true }) }), ctx())).toBeNull();
    expect(boardKeyAction(ev("Delete"), ctx({ overlayOpen: true }))).toBeNull();
  });
  it("Ctrl·Alt·Shift 조합은 지우지 않는다", () => {
    expect(boardKeyAction(ev("Delete", { ctrlKey: true }), ctx())).toBeNull();
    expect(boardKeyAction(ev("Backspace", { shiftKey: true }), ctx())).toBeNull();
  });
});

describe("boardKeyAction: 복제·선택 해제·순환", () => {
  it("Ctrl+D, ⌘+D 는 복제", () => {
    expect(boardKeyAction(ev("d", { ctrlKey: true }), ctx())).toEqual({ type: "duplicate" });
    expect(boardKeyAction(ev("D", { metaKey: true }), ctx())).toEqual({ type: "duplicate" });
    expect(boardKeyAction(ev("d"), ctx())).toBeNull();
    expect(boardKeyAction(ev("d", { ctrlKey: true }), ctx({ canEdit: false }))).toBeNull();
  });
  it("Esc 는 선택 해제(선택이 있을 때만)", () => {
    expect(boardKeyAction(ev("Escape"), ctx({ canEdit: false }))).toEqual({ type: "deselect" });
    expect(boardKeyAction(ev("Escape"), ctx({ hasSelection: false }))).toBeNull();
    expect(boardKeyAction(ev("Escape"), ctx({ overlayOpen: true }))).toBeNull();
  });
  it("Tab 은 보드에 포커스가 있고 선택이 있을 때만 순환", () => {
    const board = target({ id: "game-board" });
    expect(boardKeyAction(ev("Tab", { target: board }), ctx())).toEqual({ type: "cycle", dir: 1 });
    expect(boardKeyAction(ev("Tab", { target: board, shiftKey: true }), ctx())).toEqual({ type: "cycle", dir: -1 });
    expect(boardKeyAction(ev("Tab"), ctx())).toBeNull();
    expect(boardKeyAction(ev("Tab", { target: board }), ctx({ hasSelection: false }))).toBeNull();
  });
});

describe("nextTokenId", () => {
  const ids = ["a", "b", "c"];
  it("다음·이전으로 돌아간다", () => {
    expect(nextTokenId(ids, "a", 1)).toBe("b");
    expect(nextTokenId(ids, "c", 1)).toBe("a");
    expect(nextTokenId(ids, "a", -1)).toBe("c");
  });
  it("토큰이 아닌 것을 골랐으면 처음·끝에서 시작", () => {
    expect(nextTokenId(ids, "prop", 1)).toBe("a");
    expect(nextTokenId(ids, null, -1)).toBe("c");
  });
  it("토큰이 없으면 null", () => {
    expect(nextTokenId([], "a", 1)).toBeNull();
  });
});

describe("duplicateSpot", () => {
  it("오른쪽 아래로 조금 옮긴다", () => {
    expect(duplicateSpot(100, 100)).toEqual({ x: 140, y: 140 });
  });
  it("가장자리에서는 반대쪽으로 옮겨 보드 밖으로 나가지 않는다", () => {
    expect(duplicateSpot(990, 790)).toEqual({ x: 950, y: 750 });
  });
});
