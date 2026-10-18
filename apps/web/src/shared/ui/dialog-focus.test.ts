import { describe, expect, it } from "vitest";
import { isTop, trapTarget } from "./dialog-focus";

describe("대화상자 초점 가두기", () => {
  it("끝에서 Tab이면 처음으로, 처음에서 Shift+Tab이면 끝으로 간다", () => {
    expect(trapTarget(3, 2, false)).toBe(0);
    expect(trapTarget(3, 0, true)).toBe(2);
  });
  it("가운데에서는 브라우저에 맡긴다", () => {
    expect(trapTarget(3, 1, false)).toBeNull();
    expect(trapTarget(3, 1, true)).toBeNull();
  });
  it("밖에 있으면 안으로 들이고, 갈 곳이 없으면 자체에 둔다", () => {
    expect(trapTarget(3, -1, false)).toBe(0);
    expect(trapTarget(3, -1, true)).toBe(2);
    expect(trapTarget(0, -1, false)).toBe(-1);
  });
  it("맨 위 대화상자만 반응한다", () => {
    const a = {};
    const b = {};
    expect(isTop([a, b], b)).toBe(true);
    expect(isTop([a, b], a)).toBe(false);
  });
});
