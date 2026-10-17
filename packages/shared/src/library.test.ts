import { describe, expect, it } from "vitest";
import { emptyLibrary, librarySchema, MAX_MACROS, mergeLibrary } from "./library";

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

describe("서재 합치기", () => {
  const L = (macros: ReturnType<typeof macro>[] = [], occupations: ReturnType<typeof job>[] = []) => ({ macros, occupations }) as never;
  const a = macro({ id: "a", name: "가" });
  const b = macro({ id: "b", name: "나" });
  const c = macro({ id: "c", name: "다" });

  it("서로 다른 항목을 추가하면 둘 다 남는다", () => {
    const r = mergeLibrary(L([a]), L([a, b]), L([a, c]));
    expect(r?.macros.map((m) => m.id)).toEqual(["a", "c", "b"]);
  });
  it("한쪽이 지우고 다른 쪽은 건드리지 않았으면 지워진다", () => {
    expect(mergeLibrary(L([a, b]), L([a]), L([a, b]))?.macros.map((m) => m.id)).toEqual(["a"]);
  });
  it("내가 지웠어도 상대가 고쳤으면 고친 것이 남는다", () => {
    const edited = { ...b, expr: "2d6" };
    expect(mergeLibrary(L([a, b]), L([a]), L([a, edited]))?.macros[1]).toEqual(edited);
  });
  it("같은 항목을 둘 다 고치면 내 것이 이긴다", () => {
    const mine = { ...a, expr: "1d8" };
    const theirs = { ...a, expr: "1d10" };
    expect(mergeLibrary(L([a]), L([mine]), L([theirs]))?.macros[0]).toEqual(mine);
  });
  it("상대만 고친 항목은 상대 값을 쓴다", () => {
    const theirs = { ...a, expr: "1d10" };
    expect(mergeLibrary(L([a]), L([a]), L([theirs]))?.macros[0]).toEqual(theirs);
  });
  it("합친 결과가 규칙에 안 맞으면(이름 중복) null이다", () => {
    expect(mergeLibrary(L([]), L([macro({ id: "x", name: "같음" })]), L([macro({ id: "y", name: "같음" })]))).toBeNull();
  });
});
