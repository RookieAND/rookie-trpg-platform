import { describe, expect, it } from "vitest";
import { isHelpKey, shortcutGroups } from "./shortcuts";

const keysOf = (isKp: boolean) => shortcutGroups({ isKp, mod: "Ctrl" }).flatMap((g) => g.items.flatMap((i) => i.keys));

describe("단축키 목록", () => {
  it("GM에게는 지우기·되돌리기·복제·숫자 칸·검색까지 모두 보인다", () => {
    const k = keysOf(true);
    for (const want of ["Delete", "Ctrl+Z", "Ctrl+D", "Esc", "Tab", "방향키", "Shift+방향키", "+", "0", "1 ~ 9", "Ctrl+K", "?"]) expect(k).toContain(want);
  });
  it("PL에게는 GM 전용 키를 보여 주지 않는다", () => {
    const k = keysOf(false);
    for (const gone of ["Delete", "Ctrl+Z", "Ctrl+D", "1 ~ 9", "Ctrl+K"]) expect(k).not.toContain(gone);
    expect(k).toContain("방향키");
    expect(k).toContain("?");
  });
  it("맥에서는 수정 키가 ⌘로 보인다", () => {
    expect(shortcutGroups({ isKp: true, mod: "⌘" }).flatMap((g) => g.items.flatMap((i) => i.keys))).toContain("⌘+Z");
  });
});

describe("도움말 키", () => {
  const e = (key: string, target: unknown = { tagName: "DIV" }, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, target: target as EventTarget, ...mods });
  it("물음표 키로 열리고, 입력칸에서는 열리지 않는다", () => {
    expect(isHelpKey(e("?"))).toBe(true);
    expect(isHelpKey(e("?", { tagName: "INPUT" }))).toBe(false);
    expect(isHelpKey(e("?", { tagName: "TEXTAREA" }))).toBe(false);
    expect(isHelpKey(e("?", { isContentEditable: true }))).toBe(false);
  });
  it("다른 키나 수정 키와 함께는 열리지 않는다", () => {
    expect(isHelpKey(e("/"))).toBe(false);
    expect(isHelpKey(e("?", undefined, { ctrlKey: true }))).toBe(false);
  });
});
