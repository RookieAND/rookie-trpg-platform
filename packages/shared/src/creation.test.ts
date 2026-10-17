import { describe, expect, it } from "vitest";
import { checkOccupation, applyAge, ageRules, buildCharacterInput, checkAgeAdjustment, checkAllocation, creationSkills, eduImprovement, occupationPoints, personalPoints, rollLuckFor } from "./creation";
import { characterInputSchema } from "./protocol";

const base = { STR: 60, CON: 55, SIZ: 65, DEX: 70, APP: 50, INT: 75, POW: 60, EDU: 70 };
const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length]!;
};

describe("나이 보정", () => {
  it("나이대마다 규칙이 다르다", () => {
    expect(ageRules(17)).toMatchObject({ physicalKeys: ["STR", "SIZ"], physicalPenalty: 5, eduPenalty: 5, eduChecks: 0, luckTwice: true });
    expect(ageRules(25)).toMatchObject({ physicalPenalty: 0, appPenalty: 0, eduChecks: 1 });
    expect(ageRules(45)).toMatchObject({ physicalPenalty: 5, appPenalty: 5, eduChecks: 2 });
    expect(ageRules(55)).toMatchObject({ physicalPenalty: 10, appPenalty: 10, eduChecks: 3 });
    expect(ageRules(65)).toMatchObject({ physicalPenalty: 20, appPenalty: 15, eduChecks: 4 });
    expect(ageRules(75)).toMatchObject({ physicalPenalty: 40, appPenalty: 20 });
    expect(ageRules(85)).toMatchObject({ physicalPenalty: 80, appPenalty: 25 });
  });

  it("신체 감소분은 합계가 맞고 허용된 특성치에서만 깎는다", () => {
    const r = ageRules(45);
    expect(checkAgeAdjustment(r, { STR: 2, CON: 3 })).toBeNull();
    expect(checkAgeAdjustment(r, { STR: 2 })).toMatch(/합계 5/);
    expect(checkAgeAdjustment(r, { SIZ: 5 })).toMatch(/SIZ/);
    expect(checkAgeAdjustment(r, { STR: -1, CON: 6 })).toMatch(/0 이상/);
    expect(checkAgeAdjustment(ageRules(30), {})).toBeNull();
  });

  it("보정을 적용하면 깎인 값과 APP·EDU가 반영되고 1~99로 묶인다", () => {
    const youth = applyAge(base, ageRules(17), { STR: 3, SIZ: 2 });
    expect(youth).toMatchObject({ STR: 57, SIZ: 63, EDU: 65, APP: 50 });
    const old = applyAge(base, ageRules(45), { DEX: 5 }, 0);
    expect(old).toMatchObject({ DEX: 65, APP: 45 });
    expect(applyAge({ ...base, EDU: 96 }, ageRules(25), {}, 9).EDU).toBe(99);
    expect(applyAge({ ...base, APP: 10 }, ageRules(85), {}).APP).toBe(1);
  });

  it("교육 향상: 현재 EDU보다 클 때만 1d10이 오른다", () => {
    // d100=71(>70) → 1d10=4, 그다음 d100=10 → 변화 없음. rng는 (x-1)/N 꼴
    const r = eduImprovement(70, 2, seq(0.70, 0.3, 0.09, 0));
    expect(r.steps).toEqual([{ roll: 71, gain: 4 }, { roll: 10, gain: 0 }]);
    expect(r.edu).toBe(74);
    expect(eduImprovement(98, 1, seq(0.99, 0.99)).edu).toBe(99);
    expect(eduImprovement(70, 0, seq(0.5)).steps).toEqual([]);
  });

  it("어리면 행운을 두 번 굴려 높은 쪽을 쓴다", () => {
    // 3d6: 1,1,1 → 15 / 6,6,6 → 90
    const rng = seq(0, 0, 0, 0.99, 0.99, 0.99);
    expect(rollLuckFor(17, rng)).toBe(90);
    expect(rollLuckFor(30, seq(0, 0, 0))).toBe(15);
  });
});

describe("기능 포인트", () => {
  it("직업·관심 포인트를 공식대로 계산한다", () => {
    expect(occupationPoints(base, "edu4")).toBe(280);
    expect(occupationPoints(base, "edu2dex2")).toBe(280);
    expect(occupationPoints(base, "edu2app2")).toBe(240);
    expect(personalPoints(base)).toBe(150);
  });

  it("쓴 포인트를 세고 한도·상한·고정 기능을 검사한다", () => {
    const ok = checkAllocation(base, "edu4", { 관찰력: { occ: 30, personal: 10 }, 심리학: { occ: 20, personal: 0 } });
    expect(ok).toMatchObject({ occUsed: 50, personalUsed: 10, errors: [] });
    expect(checkAllocation(base, "edu4", { 관찰력: { occ: 281, personal: 0 } }).errors.join()).toMatch(/직업 포인트를 1점/);
    expect(checkAllocation(base, "edu4", { 설득: { occ: 0, personal: 151 } }).errors.join()).toMatch(/관심 포인트를 1점/);
    expect(checkAllocation(base, "edu4", { 관찰력: { occ: 51, personal: 0 } }).errors.join()).toMatch(/75까지/);
    expect(checkAllocation(base, "edu4", { "크툴루 신화": { occ: 5, personal: 0 } }).errors.join()).toMatch(/쓸 수 없어요/);
    expect(checkAllocation(base, "edu4", { 없는기능: { occ: 1, personal: 0 } }).errors.join()).toMatch(/알 수 없는/);
    expect(checkAllocation(base, "edu4", { 관찰력: { occ: -1, personal: 0 } }).errors.length).toBeGreaterThan(0);
  });

  it("신용도가 기본 기능에 있고 모든 기능 이름이 겹치지 않는다", () => {
    const names = creationSkills(base).map((s) => s.name);
    expect(names).toContain("신용도");
    expect(new Set(names).size).toBe(names.length);
  });

  it("마법사 결과는 보관함 입력 규칙을 통과하고 포인트가 값에 더해진다", () => {
    const input = buildCharacterInput({ name: " 카를로 ", age: 30, occupation: "기자", characteristics: base, luck: 55, alloc: { 관찰력: { occ: 30, personal: 10 }, 신용도: { occ: 20, personal: 0 } } });
    const parsed = characterInputSchema.parse(input);
    const v = Object.fromEntries(parsed.skills.map((s) => [s.name, s.value]));
    expect(parsed.name).toBe("카를로");
    expect(v["관찰력"]).toBe(65);
    expect(v["신용도"]).toBe(20);
    expect(v["회피"]).toBe(35);
    expect(v["모국어"]).toBe(70);
  });
});

describe("직업 정의", () => {
  const job = { name: "기자", formula: "edu4" as const, creditMin: 9, creditMax: 30, skills: ["관찰력", "설득", "심리학"] };
  it("쓸 수 있는 모양만 받는다", () => {
    expect(checkOccupation(job)).toBeNull();
    expect(checkOccupation({ ...job, name: " " })).toMatch(/이름/);
    expect(checkOccupation({ ...job, creditMin: 40 })).toMatch(/최소/);
    expect(checkOccupation({ ...job, creditMax: 100 })).toMatch(/0~99/);
    expect(checkOccupation({ ...job, skills: ["관찰력", "관찰력"] })).toMatch(/두 번/);
    expect(checkOccupation({ ...job, skills: ["없는기능"] })).toMatch(/넣을 수 없어요/);
    expect(checkOccupation({ ...job, skills: ["모국어"] })).toMatch(/넣을 수 없어요/);
    expect(checkOccupation({ ...job, skills: ["신용도"] })).toMatch(/넣을 수 없어요/);
    expect(checkOccupation({ ...job, skills: Array.from({ length: 13 }, (_, i) => `s${i}`) })).toMatch(/12개/);
  });

  it("직업 포인트는 직업 기능과 신용도에만 쓰고, 신용도는 범위 안이어야 한다", () => {
    const o = { id: "j", ...job };
    const ok = checkAllocation(base, "edu4", { 관찰력: { occ: 30, personal: 0 }, 신용도: { occ: 15, personal: 0 }, 법률: { occ: 0, personal: 10 } }, o);
    expect(ok.errors).toEqual([]);
    expect(checkAllocation(base, "edu4", { 법률: { occ: 5, personal: 0 }, 신용도: { occ: 15, personal: 0 } }, o).errors.join()).toMatch(/법률: 직업 포인트는 '기자'/);
    expect(checkAllocation(base, "edu4", {}, o).errors.join()).toMatch(/신용도은\(는\) '기자'에서 9~30 사이.*지금 0/);
    expect(checkAllocation(base, "edu4", { 신용도: { occ: 31, personal: 0 } }, o).errors.join()).toMatch(/9~30/);
    // 직업을 안 고르면 이 제한은 없다
    expect(checkAllocation(base, "edu4", { 법률: { occ: 5, personal: 0 } }).errors).toEqual([]);
  });
});
