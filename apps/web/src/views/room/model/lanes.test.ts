import { describe, expect, it } from "vitest";
import { overlaps, toastLane } from "./lanes";

const board = { left: 0, right: 1000, top: 44, bottom: 700 };

describe("toastLane", () => {
  it("겹치는 것이 없으면 보드 바로 위에 띄워요", () => {
    expect(toastLane({ viewportH: 900, board, corner: [] })).toEqual({ bottom: 210, centerX: 500, width: 1000 });
  });
  it("보드 아래 구석에 놓인 것 중 가장 높은 것 위로 올려요", () => {
    const l = toastLane({ viewportH: 900, board, corner: [{ left: 12, right: 110, top: 660, bottom: 690 }, { left: 600, right: 980, top: 600, bottom: 690 }] });
    expect(l.bottom).toBe(200 + 100 + 10);
  });
  it("높이 0인 것(숨은 것)은 무시해요", () => {
    expect(toastLane({ viewportH: 900, board, corner: [{ left: 0, right: 0, top: 0, bottom: 0 }] }).bottom).toBe(210);
  });
  it("펼친 도구 묶음 위로 올려요", () => {
    expect(toastLane({ viewportH: 844, board: { left: 0, right: 390, top: 100, bottom: 700 }, corner: [], sheetTop: 420 }).bottom).toBe(844 - 420 + 10);
  });
});

describe("overlaps", () => {
  const a = { left: 0, right: 10, top: 0, bottom: 10 };
  it("겹치면 true, 맞닿기만 하면 false", () => {
    expect(overlaps(a, { left: 5, right: 15, top: 5, bottom: 15 })).toBe(true);
    expect(overlaps(a, { left: 10, right: 20, top: 0, bottom: 10 })).toBe(false);
    expect(overlaps(a, { left: 20, right: 30, top: 20, bottom: 30 })).toBe(false);
  });
});
