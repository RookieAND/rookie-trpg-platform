import { z } from "zod";
import { checkOccupation, OCCUPATION_POINT_FORMULAS, type Occupation, type OccupationFormulaId } from "./creation";
import { rollExpression } from "./dice";

/** 사용자 한 명의 개인 서재: 굴림 매크로와 직업 정의. 서버에 저장해 기기를 옮겨도 따라온다. */

export const MAX_MACROS = 12;
export const MAX_MACRO_NAME = 20;
export const MAX_OCCUPATIONS = 20;

export interface Macro {
  id: string;
  name: string;
  expr: string;
  /** 비밀 굴림으로 굴린다(GM만 쓴다) */
  secret: boolean;
}

/** 굴림 식이 서버가 받아 줄 모양인지 본다. */
export const isValidRollExpr = (expr: string): boolean => {
  const e = expr.trim();
  return e.length > 0 && e.length <= 80 && rollExpression(e, () => 0).ok;
};

const macroSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(MAX_MACRO_NAME),
  expr: z.string().trim().refine(isValidRollExpr, "굴림 식을 알아볼 수 없어요."),
  secret: z.boolean(),
});

const FORMULA_IDS = OCCUPATION_POINT_FORMULAS.map((f) => f.id) as [OccupationFormulaId, ...OccupationFormulaId[]];

const occupationSchema = z
  .object({
    id: z.string().min(1).max(40),
    name: z.string().trim().min(1).max(40),
    formula: z.enum(FORMULA_IDS),
    creditMin: z.number().int().min(0).max(99),
    creditMax: z.number().int().min(0).max(99),
    skills: z.array(z.string().max(30)).max(40),
  })
  .superRefine((o, ctx) => {
    const problem = checkOccupation(o);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

const unique = (names: string[]) => new Set(names).size === names.length;

export const librarySchema = z
  .object({
    macros: z.array(macroSchema).max(MAX_MACROS),
    occupations: z.array(occupationSchema).max(MAX_OCCUPATIONS),
  })
  .refine((l) => unique(l.macros.map((m) => m.name)), { message: "같은 이름의 매크로가 있어요.", path: ["macros"] })
  .refine((l) => unique(l.macros.map((m) => m.id)) && unique(l.occupations.map((o) => o.id)), { message: "id가 겹쳐요.", path: ["id"] })
  .refine((l) => unique(l.occupations.map((o) => o.name)), { message: "같은 이름의 직업이 있어요.", path: ["occupations"] });

export interface Library {
  macros: Macro[];
  occupations: Occupation[];
}

export const emptyLibrary = (): Library => ({ macros: [], occupations: [] });

const sameItem = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** id가 있는 항목 목록을 세 갈래로 합친다. base=내가 마지막으로 받은 것, mine=내가 바꾼 것, theirs=서버의 최신. */
function mergeById<T extends { id: string }>(base: T[], mine: T[], theirs: T[]): T[] {
  const baseById = new Map(base.map((x) => [x.id, x]));
  const mineById = new Map(mine.map((x) => [x.id, x]));
  const theirsIds = new Set(theirs.map((x) => x.id));
  const out: T[] = [];
  for (const t of theirs) {
    const b = baseById.get(t.id);
    const m = mineById.get(t.id);
    if (!b) out.push(t); // 다른 기기에서 새로 만든 것
    else if (!m) {
      if (!sameItem(b, t)) out.push(t); // 내가 지웠지만 상대가 고쳤으면 살린다
    } else out.push(sameItem(b, m) ? t : m); // 내가 고친 쪽을 우선한다
  }
  for (const m of mine) if (!baseById.has(m.id) && !theirsIds.has(m.id)) out.push(m); // 내가 새로 만든 것
  return out;
}

/**
 * 두 기기에서 서재를 따로 고쳤을 때 항목(id) 단위로 합친다.
 * 같은 항목을 둘 다 고쳤으면 내가 고친 것을 쓴다. 합친 결과가 규칙(개수·이름 중복 등)에 맞지 않으면 null이다.
 */
export function mergeLibrary(base: Library, mine: Library, theirs: Library): Library | null {
  const merged: Library = {
    macros: mergeById(base.macros, mine.macros, theirs.macros),
    occupations: mergeById(base.occupations, mine.occupations, theirs.occupations),
  };
  return librarySchema.safeParse(merged).success ? merged : null;
}
