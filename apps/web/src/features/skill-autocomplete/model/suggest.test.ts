import { describe, expect, it } from "vitest";
import { completeText, looksLikeDice, parseSkillQuery, resolveSkill, suggestSkills, toChoseong, type SkillOption } from "./suggest";

const opts: SkillOption[] = [
  { name: "관찰력", value: 55, kind: "skill" },
  { name: "도서관 이용", value: 40, kind: "skill" },
  { name: "자동차 운전", value: 30, kind: "skill" },
  { name: "사격(권총)", value: 45, kind: "skill" },
  { name: "STR", value: 60, kind: "stat" },
  { name: "DEX", value: 50, kind: "stat" },
  { name: "행운", value: 65, kind: "luck" },
];
const names = (r: SkillOption[]) => r.map((o) => o.name);

describe("parseSkillQuery", () => {
  it("이름만", () => expect(parseSkillQuery("관찰력")).toEqual({ name: "관찰력", bonus: 0 }));
  it("난이도와 보너스를 뗀다", () => {
    expect(parseSkillQuery("관찰력 어려움")).toEqual({ name: "관찰력", difficulty: "hard", bonus: 0 });
    expect(parseSkillQuery("관찰력 하드 -1")).toEqual({ name: "관찰력", difficulty: "hard", bonus: -1 });
    expect(parseSkillQuery("관찰력 +2")).toEqual({ name: "관찰력", bonus: 2 });
  });
  it("띄어쓰기가 있는 이름은 그대로 둔다", () => expect(parseSkillQuery("자동차 운전 극단")).toEqual({ name: "자동차 운전", difficulty: "extreme", bonus: 0 }));
  it("CC<=를 받는다", () => expect(parseSkillQuery("CC<=관찰력")).toEqual({ name: "관찰력", bonus: 0 }));
  it("이름이 비면 null", () => {
    expect(parseSkillQuery("  ")).toBeNull();
    expect(parseSkillQuery("cc<=")).toBeNull();
  });
  it("±3은 보너스로 보지 않는다", () => expect(parseSkillQuery("관찰력 +3")?.name).toBe("관찰력 +3"));
});

describe("looksLikeDice", () => {
  it("식은 이름이 아니다", () => {
    for (const t of ["1d100", "d100", "d", "2d6+1", "db", "(2d6+6)*5", "CC", "CC<=60", "CC+1", "cbr(40,30)", "+1"]) expect(looksLikeDice(t), t).toBe(true);
  });
  it("이름은 식이 아니다", () => {
    for (const t of ["관찰력", "STR", "dex", "ㄱㅊ", "행운"]) expect(looksLikeDice(t), t).toBe(false);
  });
});

describe("suggestSkills", () => {
  it("앞부분 일치가 먼저", () => expect(names(suggestSkills(opts, "관"))).toEqual(["관찰력", "도서관 이용"]));
  it("띄어쓰기를 무시한다", () => expect(names(suggestSkills(opts, "자동차운"))).toEqual(["자동차 운전"]));
  it("영문 특성치는 대소문자 무관", () => expect(names(suggestSkills(opts, "dex"))).toEqual(["DEX"]));
  it("초성으로 찾는다", () => {
    expect(toChoseong("관찰력")).toBe("ㄱㅊㄹ");
    expect(names(suggestSkills(opts, "ㄱㅊ"))[0]).toBe("관찰력"); // 초성이 앞에서 맞는 것이 먼저
    expect(names(suggestSkills(opts, "ㅎㅇ"))).toEqual(["행운"]);
  });
  it("괄호가 든 이름", () => expect(names(suggestSkills(opts, "사격("))).toEqual(["사격(권총)"]));
  it("주사위 식에는 제안하지 않는다", () => {
    expect(suggestSkills(opts, "d")).toEqual([]);
    expect(suggestSkills(opts, "1d100")).toEqual([]);
    expect(suggestSkills(opts, "")).toEqual([]);
  });
  it("개수 상한", () => expect(suggestSkills(Array.from({ length: 20 }, (_, i) => ({ name: `기능${i}`, value: 1, kind: "skill" as const })), "기능", 5)).toHaveLength(5));
});

describe("resolveSkill / completeText", () => {
  it("정확히 같을 때만 찾는다", () => {
    expect(resolveSkill(opts, "관찰력")?.value).toBe(55);
    expect(resolveSkill(opts, "자동차운전")?.name).toBe("자동차 운전");
    expect(resolveSkill(opts, "관찰")).toBeNull();
  });
  it("난이도·보너스를 이어 붙인다", () => {
    expect(completeText("관 하드 +1", opts[0]!)).toBe("관찰력 어려움 +1");
    expect(completeText("관", opts[0]!)).toBe("관찰력");
  });
});
