import { describe, expect, it } from "vitest";
import { scrollTarget, tabEdges } from "./tab-scroll";

describe("tabEdges", () => {
  it("다 들어가면 어느 쪽도 잘리지 않아요", () => {
    expect(tabEdges(0, 300, 300)).toEqual({ left: false, right: false });
  });
  it("넘치면 처음에는 오른쪽만, 끝에서는 왼쪽만, 가운데는 양쪽이 잘려요", () => {
    expect(tabEdges(0, 300, 420)).toEqual({ left: false, right: true });
    expect(tabEdges(120, 300, 420)).toEqual({ left: true, right: false });
    expect(tabEdges(50, 300, 420)).toEqual({ left: true, right: true });
  });
  it("소수점 오차는 잘린 것으로 치지 않아요", () => {
    expect(tabEdges(0.4, 300, 300.6)).toEqual({ left: false, right: false });
  });
});

describe("scrollTarget", () => {
  it("이미 보이면 그대로예요", () => {
    expect(scrollTarget(0, 300, 100, 50)).toBe(0);
  });
  it("오른쪽에 가려진 탭은 끝이 보이게 옮겨요", () => {
    expect(scrollTarget(0, 300, 320, 60)).toBe(320 + 60 + 28 - 300);
  });
  it("왼쪽에 가려진 탭은 앞이 보이게 옮기고 0 아래로 가지 않아요", () => {
    expect(scrollTarget(200, 300, 210, 50)).toBe(182);
    expect(scrollTarget(100, 300, 10, 50)).toBe(0);
  });
});
