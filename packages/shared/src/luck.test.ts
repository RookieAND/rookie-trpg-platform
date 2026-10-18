import { describe, expect, it } from "vitest";
import { rollExpression, type Rng, type RollOutcome } from "./dice";
import { applyLuck, luckNeeded, luckSpentText } from "./luck";

const seq = (...v: number[]): Rng => {
  let i = 0;
  return () => v[i++ % v.length]!;
};
const roll = (expr: string, ...v: number[]) => {
  const r = rollExpression(expr, seq(...v));
  if (!r.ok) throw new Error(r.error);
  return r.outcome as Extract<RollOutcome, { kind: "cc" }>;
};

describe("luckNeeded", () => {
  it("실패를 보통 성공으로 바꾸는 데 필요한 행운", () => {
    expect(luckNeeded(roll("CC<=60", 0.9, 0.8))).toBe(29); // 89 → 60
  });
  it("난이도가 있으면 그 기준까지 낮춰야 한다", () => {
    expect(luckNeeded(roll("CC<=60h", 0.9, 0.5))).toBe(29); // 59 → 어려움 기준 30까지 29
  });
  it("성공했거나 목표값이 없으면 null", () => {
    expect(luckNeeded(roll("CC<=60", 0.3, 0.2))).toBeNull();
    expect(luckNeeded(roll("CC", 0.3, 0.2))).toBeNull();
  });
  it("극단 기준이 0이면(목표값 4 이하) 바꿀 수 없다", () => {
    expect(luckNeeded(roll("CC<=4e", 0.9, 0.8))).toBeNull();
  });
});

describe("applyLuck", () => {
  it("행운만큼 결과를 낮추고 단계를 다시 계산한다", () => {
    const o = roll("CC<=60", 0.9, 0.8);
    const after = applyLuck(o, 29);
    expect(after).toMatchObject({ percent: { total: 60 }, level: "regular", success: true, luckSpent: 29 });
  });
  it("난이도 판정도 다시 평가한다", () => {
    const o = roll("CC<=60h", 0.9, 0.5);
    const after = applyLuck(o, luckNeeded(o)!);
    expect(after).toMatchObject({ level: "hard", success: true });
  });
});

describe("luckSpentText", () => {
  it("숫자 뒤 조사를 읽는 소리에 맞춘다", () => {
    expect(luckSpentText(32, 30)).toBe("행운 32를 써서 62가 30이 됐어요.");
    expect(luckSpentText(10, 40)).toBe("행운 10을 써서 50이 40이 됐어요.");
    expect(luckSpentText(1, 5)).toBe("행운 1을 써서 6이 5가 됐어요.");
    expect(luckSpentText(3, 12)).toBe("행운 3을 써서 15가 12가 됐어요.");
  });
});
