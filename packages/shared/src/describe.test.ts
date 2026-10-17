import { describe, expect, it } from "vitest";
import { describeOutcome } from "./describe";
import { runCommand, parseCommand } from "./dice";

const run = (expr: string, v: number) => {
  const p = parseCommand(expr);
  if (!p.ok) throw new Error(p.error);
  return runCommand(p.command, expr, () => v);
};

describe("describeOutcome", () => {
  it("일반 주사위", () => expect(describeOutcome(run("2d6+1", 0.5))).toBe("[4, 4]+1 = 9"));
  it("CC 판정은 결과 단계를 말해 준다", () => expect(describeOutcome(run("CC<=60", 0.39))).toBe("33 → 성공"));
  it("난이도를 정하면 통과/미달", () => expect(describeOutcome(run("CC<=60h", 0.39))).toBe("33 → 성공 · 미달"));
  it("목표값이 없으면 숫자만", () => expect(describeOutcome(run("CC", 0.39))).toBe("33"));
});
