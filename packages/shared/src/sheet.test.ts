import { describe, expect, it } from "vitest";
import { CHARACTERISTIC_KEYS, defaultSkillValues, isSkillEdited, rollCharacteristics, skillBaseValues } from "./sheet";

describe("rollCharacteristics", () => {
  it("모든 주사위가 1이면 최소값, 6이면 최대값이다", () => {
    const lo = rollCharacteristics(() => 0);
    expect(lo.characteristics).toMatchObject({ STR: 15, CON: 15, DEX: 15, APP: 15, POW: 15, SIZ: 40, INT: 40, EDU: 40 });
    expect(lo.luck).toBe(15);
    const hi = rollCharacteristics(() => 0.999);
    expect(hi.characteristics).toMatchObject({ STR: 90, SIZ: 90 });
    expect(hi.luck).toBe(90);
  });

  it("무작위 결과도 5의 배수이고 범위 안이다", () => {
    for (let i = 0; i < 50; i++) {
      const r = rollCharacteristics(Math.random);
      for (const k of CHARACTERISTIC_KEYS) {
        expect(r.characteristics[k] % 5).toBe(0);
        expect(r.characteristics[k]).toBeGreaterThanOrEqual(15);
        expect(r.characteristics[k]).toBeLessThanOrEqual(90);
      }
    }
  });
});

describe("defaultSkillValues", () => {
  const stats = { STR: 50, CON: 50, SIZ: 50, DEX: 65, APP: 50, INT: 50, POW: 50, EDU: 70 };
  it("회피는 DEX의 절반, 모국어는 EDU다", () => {
    const v = Object.fromEntries(defaultSkillValues({ characteristics: stats }).map((s) => [s.name, s.value]));
    expect(v["회피"]).toBe(32);
    expect(v["모국어"]).toBe(70);
    expect(v["도서관 이용"]).toBe(20);
  });
  it("이름이 겹치지 않는다", () => {
    const names = defaultSkillValues({ characteristics: stats }).map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("isSkillEdited", () => {
  const base = skillBaseValues({ characteristics: { STR: 50, CON: 50, SIZ: 50, DEX: 60, APP: 50, INT: 50, POW: 50, EDU: 70 } });
  it("초기값 그대로면 손대지 않은 기능이다 (회피는 DEX 절반, 모국어는 EDU)", () => {
    expect(isSkillEdited(base, "관찰력", { value: 25 })).toBe(false);
    expect(isSkillEdited(base, "회피", { value: 30 })).toBe(false);
    expect(isSkillEdited(base, "모국어", { value: 70, grown: false })).toBe(false);
  });
  it("값이 다르거나 성장 표시가 있거나 목록에 없으면 손댄 기능이다", () => {
    expect(isSkillEdited(base, "관찰력", { value: 26 })).toBe(true);
    expect(isSkillEdited(base, "관찰력", { value: 25, grown: true })).toBe(true);
    expect(isSkillEdited(base, "새 기능", { value: 1 })).toBe(true);
    expect(isSkillEdited(base, "", { value: 20 })).toBe(true);
  });
});
