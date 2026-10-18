import { describe, expect, it } from "vitest";
import { isUndoKey, undoHint } from "./shortcut";

const ev = (o: Partial<Parameters<typeof isUndoKey>[0]> & { tag?: string }) => ({ key: "z", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, target: { tagName: o.tag ?? "DIV" } as unknown as EventTarget, ...o });

describe("isUndoKey", () => {
  it("Ctrl+Z, ⌘+Z 는 되돌리기", () => {
    expect(isUndoKey(ev({}))).toBe(true);
    expect(isUndoKey(ev({ ctrlKey: false, metaKey: true, key: "Z" }))).toBe(true);
  });
  it("입력칸·텍스트영역·select 에서는 무시", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) expect(isUndoKey(ev({ tag }))).toBe(false);
  });
  it("Shift/Alt 조합이나 다른 키는 무시", () => {
    expect(isUndoKey(ev({ shiftKey: true }))).toBe(false);
    expect(isUndoKey(ev({ key: "y" }))).toBe(false);
    expect(isUndoKey(ev({ ctrlKey: false }))).toBe(false);
  });
});

describe("undoHint", () => {
  it("되돌릴 수 있는 삭제에만 안내", () => {
    expect(undoHint("object.remove")).toContain("Ctrl+Z");
    expect(undoHint("audio.track.remove")).toBeNull();
  });
});
