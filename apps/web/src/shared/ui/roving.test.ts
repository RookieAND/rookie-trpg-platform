import { describe, expect, it } from "vitest";
import { nextRovingIndex } from "./roving";

describe("nextRovingIndex", () => {
  it("오른쪽·왼쪽으로 한 칸씩 옮겨요", () => {
    expect(nextRovingIndex(5, 1, "ArrowRight")).toBe(2);
    expect(nextRovingIndex(5, 1, "ArrowLeft")).toBe(0);
  });
  it("끝에서는 멈추고, loop면 돌아요", () => {
    expect(nextRovingIndex(5, 4, "ArrowRight")).toBe(4);
    expect(nextRovingIndex(5, 0, "ArrowLeft")).toBe(0);
    expect(nextRovingIndex(5, 4, "ArrowRight", true)).toBe(0);
    expect(nextRovingIndex(5, 0, "ArrowLeft", true)).toBe(4);
  });
  it("Home과 End는 처음과 끝이에요", () => {
    expect(nextRovingIndex(9, 4, "Home")).toBe(0);
    expect(nextRovingIndex(9, 4, "End")).toBe(8);
  });
  it("다른 키나 빈 줄은 건드리지 않아요", () => {
    expect(nextRovingIndex(5, 1, "a")).toBeNull();
    expect(nextRovingIndex(0, 0, "ArrowRight")).toBeNull();
  });
});
