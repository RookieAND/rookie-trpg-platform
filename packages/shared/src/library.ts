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
  /** 비밀 굴림으로 굴린다(KP만 쓴다) */
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
