import { describe, expect, it } from "vitest";
import { emptyLibrary, librarySchema, MAX_MACROS } from "./library";

const macro = (over = {}) => ({ id: "m1", name: "한 방", expr: "1d6+2", secret: false, ...over });
const job = (over = {}) => ({ id: "o1", name: "기자", formula: "edu4", creditMin: 9, creditMax: 30, skills: ["관찰력"], ...over });

describe("개인 서재 규칙", () => {
  it("빈 서재와 올바른 서재를 받는다", () => {
    expect(librarySchema.safeParse(emptyLibrary()).success).toBe(true);
    expect(librarySchema.safeParse({ macros: [macro()], occupations: [job()] }).success).toBe(true);
  });

  it("잘못된 식·직업·중복·개수 한도를 거절한다", () => {
    const bad = (l: unknown) => expect(librarySchema.safeParse(l).success).toBe(false);
    bad({ macros: [macro({ expr: "ㅁㅁ" })], occupations: [] });
    bad({ macros: [macro({ name: "" })], occupations: [] });
    bad({ macros: [macro(), macro({ id: "m2" })], occupations: [] });
    bad({ macros: [macro(), macro({ name: "다른" })], occupations: [] });
    bad({ macros: Array.from({ length: MAX_MACROS + 1 }, (_, i) => macro({ id: `m${i}`, name: `n${i}` })), occupations: [] });
    bad({ macros: [], occupations: [job({ creditMin: 50 })] });
    bad({ macros: [], occupations: [job({ skills: ["없는기능"] })] });
    bad({ macros: [], occupations: [job(), job({ id: "o2" })] });
    bad({ macros: [] });
  });
});
