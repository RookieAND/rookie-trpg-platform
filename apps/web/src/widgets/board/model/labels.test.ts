import { describe, expect, it } from "vitest";
import { layoutLabels, truncateLabel } from "./labels";

describe("truncateLabel", () => {
  it("짧으면 그대로", () => expect(truncateLabel("민수")).toBe("민수"));
  it("14자까지는 그대로", () => expect(truncateLabel("가".repeat(14))).toBe("가".repeat(14)));
  it("넘으면 …로", () => {
    const t = truncateLabel("가".repeat(30));
    expect(Array.from(t)).toHaveLength(14);
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("layoutLabels", () => {
  it("떨어져 있으면 그대로", () => {
    const r = layoutLabels([{ id: "a", x: 0, y: 50, text: "가나" }, { id: "b", x: 500, y: 50, text: "다라" }], 12);
    expect(r.get("a")).toMatchObject({ y: 50, hidden: false });
    expect(r.get("b")).toMatchObject({ y: 50, hidden: false });
  });
  it("겹치면 아래로 비킨다", () => {
    const r = layoutLabels([{ id: "a", x: 0, y: 50, text: "가나다" }, { id: "b", x: 5, y: 50, text: "라마바" }], 12);
    expect(r.get("a")!.y).toBe(50);
    expect(r.get("b")!.y).toBeGreaterThan(50);
    expect(r.get("b")!.hidden).toBe(false);
  });
  it("너무 빽빽하면 숨기되 고른 것은 남긴다", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, x: i, y: 50, text: "가나다라", keep: i === 7 }));
    const r = layoutLabels(many, 12);
    expect(r.get("t7")!.hidden).toBe(false);
    expect([...r.values()].some((v) => v.hidden)).toBe(true);
  });
});
