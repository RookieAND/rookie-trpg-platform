import { describe, expect, it } from "vitest";
import { dropIndicator, dropSide, reorderTarget } from "./drag-order";

/** 실제 서버처럼 배열에서 빼서 index에 끼워 넣어 결과를 본다 */
function applyReorder(list: string[], from: number, to: number): string[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}

describe("dropSide", () => {
  it("탭의 왼쪽 절반이면 앞, 오른쪽 절반이면 뒤", () => {
    const rect = { left: 100, width: 80 };
    expect(dropSide(110, rect)).toBe("before");
    expect(dropSide(139, rect)).toBe("before");
    expect(dropSide(140, rect)).toBe("after");
    expect(dropSide(175, rect)).toBe("after");
  });
});

describe("reorderTarget", () => {
  const list = ["A", "B", "C", "D", "E"];

  it("앞쪽 장면을 뒤쪽 탭의 뒤로 보내면 그 탭 자리에 온다", () => {
    expect(reorderTarget(0, 3, "after", 5)).toBe(3);
    expect(applyReorder(list, 0, 3)).toEqual(["B", "C", "D", "A", "E"]);
  });

  it("앞쪽 장면을 뒤쪽 탭의 앞으로 보내면 그 탭 바로 앞에 온다", () => {
    expect(reorderTarget(0, 3, "before", 5)).toBe(2);
    expect(applyReorder(list, 0, 2)).toEqual(["B", "C", "A", "D", "E"]);
  });

  it("뒤쪽 장면을 앞쪽 탭의 앞/뒤로 보낸다", () => {
    expect(reorderTarget(4, 1, "before", 5)).toBe(1);
    expect(applyReorder(list, 4, 1)).toEqual(["A", "E", "B", "C", "D"]);
    expect(reorderTarget(4, 1, "after", 5)).toBe(2);
    expect(applyReorder(list, 4, 2)).toEqual(["A", "B", "E", "C", "D"]);
  });

  it("맨 앞·맨 끝으로 보낸다", () => {
    expect(reorderTarget(3, 0, "before", 5)).toBe(0);
    expect(reorderTarget(1, 4, "after", 5)).toBe(4);
    expect(applyReorder(list, 1, 4)).toEqual(["A", "C", "D", "E", "B"]);
  });

  it("자리가 그대로면 null", () => {
    expect(reorderTarget(2, 2, "before", 5)).toBeNull();
    expect(reorderTarget(2, 2, "after", 5)).toBeNull();
    expect(reorderTarget(2, 1, "after", 5)).toBeNull(); // 바로 앞 탭의 뒤 = 제자리
    expect(reorderTarget(2, 3, "before", 5)).toBeNull(); // 바로 뒤 탭의 앞 = 제자리
  });

  it("범위를 벗어나면 null", () => {
    expect(reorderTarget(-1, 2, "after", 5)).toBeNull();
    expect(reorderTarget(1, 5, "after", 5)).toBeNull();
    expect(reorderTarget(5, 1, "after", 5)).toBeNull();
    expect(reorderTarget(1.5, 2, "after", 5)).toBeNull();
  });

  it("모든 (from, target, side) 조합이 기대한 배열이 된다", () => {
    const n = 6;
    const base = Array.from({ length: n }, (_, i) => String(i));
    for (let from = 0; from < n; from++) {
      for (let target = 0; target < n; target++) {
        for (const side of ["before", "after"] as const) {
          const to = reorderTarget(from, target, side, n);
          const got = to === null ? base : applyReorder(base, from, to);
          // 기대: from을 뺀 목록에서 target 장면의 앞/뒤에 끼운 결과
          const rest = base.filter((_, i) => i !== from);
          const at = from === target ? -1 : rest.indexOf(base[target]!);
          const want = at < 0 ? base : [...rest.slice(0, at + (side === "after" ? 1 : 0)), base[from]!, ...rest.slice(at + (side === "after" ? 1 : 0))];
          expect(got).toEqual(want);
        }
      }
    }
  });
});

describe("dropIndicator", () => {
  it("제자리가 되는 곳에는 표시하지 않는다", () => {
    expect(dropIndicator(2, 1, "after", 5)).toBeNull();
    expect(dropIndicator(2, 2, "before", 5)).toBeNull();
    expect(dropIndicator(0, 3, "before", 5)).toEqual({ index: 3, side: "before" });
  });
});
