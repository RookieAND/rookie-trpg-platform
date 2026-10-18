import { describe, expect, it } from "vitest";
import { commonSkillNames, skillOptions } from "./skill-options";

describe("대항 판정 기능 목록", () => {
  it("시트의 기능(가나다순) 다음에 특성치와 행운", () => {
    const o = skillOptions({ skills: { 회피: { value: 30, grown: false }, 관찰력: { value: 60, grown: false } } });
    expect(o.slice(0, 2)).toEqual(["관찰력", "회피"]);
    expect(o).toContain("STR");
    expect(o.at(-1)).toBe("행운");
  });
  it("캐릭터가 없으면 비어 있다", () => {
    expect(skillOptions(undefined)).toEqual([]);
  });
  it("후보에는 회피와 특성치가 들어 있다", () => {
    const names = commonSkillNames();
    expect(names).toContain("회피");
    expect(names).toContain("관찰력");
    expect(names).toContain("POW");
  });
});
