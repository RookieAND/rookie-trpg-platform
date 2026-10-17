import { describe, expect, it } from "vitest";
import { parseMacros, parseOccupations } from "./legacy";

const job = { name: "기자", formula: "edu4", creditMin: 9, creditMax: 30, skills: ["관찰력", "설득"] };

describe("예전 브라우저 저장값 읽기", () => {
  it("매크로: 깨진 값과 잘못된 항목, 이름 중복은 버린다", () => {
    expect(parseMacros(null)).toEqual([]);
    expect(parseMacros("{")).toEqual([]);
    expect(parseMacros('{"a":1}')).toEqual([]);
    const raw = JSON.stringify([
      { id: "a", name: "좋음", expr: "1d6", secret: true },
      { id: "b", name: "나쁨", expr: "??", secret: false },
      { id: "c", name: "좋음", expr: "1d4", secret: false },
      7,
    ]);
    expect(parseMacros(raw)).toEqual([{ id: "a", name: "좋음", expr: "1d6", secret: true }]);
  });

  it("직업: 깨진 값과 쓸 수 없는 정의, 이름 중복은 버린다", () => {
    expect(parseOccupations(null)).toEqual([]);
    expect(parseOccupations("{")).toEqual([]);
    const raw = JSON.stringify([{ id: "a", ...job }, { id: "b", ...job, creditMin: 99, creditMax: 1 }, { id: "c", ...job }, { id: "d", name: "x" }, 3]);
    expect(parseOccupations(raw)).toEqual([{ id: "a", ...job }]);
  });
});
