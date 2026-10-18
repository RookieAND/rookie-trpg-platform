import { describe, expect, it } from "vitest";
import { woundHint, woundThreshold } from "./wound-hint";

describe("중상 기준과 안내 문구", () => {
  it("중상 기준은 최대 HP 절반을 올린 값", () => {
    expect(woundThreshold(12)).toBe(6);
    expect(woundThreshold(11)).toBe(6);
    expect(woundThreshold(10)).toBe(5);
    expect(woundThreshold(1)).toBe(1);
  });
  it("상태가 없으면 안내도 없다", () => {
    expect(woundHint({}, 12)).toBeNull();
    expect(woundHint({ conditions: [] }, 12)).toBeNull();
  });
  it("사망이 가장 먼저, 빈사는 라운드를 보여 준다", () => {
    expect(woundHint({ conditions: ["dead", "dying"] }, 12)).toMatchObject({ danger: true, text: expect.stringContaining("사망했어요") });
    expect(woundHint({ conditions: ["dying", "majorWound"], dyingRounds: 0 }, 12)?.text).toBe("빈사 상태예요. 응급처치가 없으면 매 라운드 건강 판정(CON)을 하고, 실패하면 사망해요.");
    expect(woundHint({ conditions: ["dying", "majorWound"], dyingRounds: 2 }, 12)?.text).toContain("(2라운드째)");
  });
  it("기절과 중상", () => {
    expect(woundHint({ conditions: ["unconscious"] }, 12)?.text).toContain("의식을 잃었어요");
    expect(woundHint({ conditions: ["majorWound"] }, 11)?.text).toContain("HP가 6 이상이 되면");
  });
});
