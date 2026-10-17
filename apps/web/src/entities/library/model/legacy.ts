import { checkOccupation, isValidRollExpr, MAX_MACRO_NAME, MAX_MACROS, MAX_OCCUPATIONS, type Macro, type Occupation } from "@coc-vtt/shared";

/** 서버 저장 이전에 브라우저에 두던 글을 읽는다. 깨진 항목은 버린다. */
export function parseMacros(raw: string | null): Macro[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    return v
      .filter((m): m is Macro => !!m && typeof m.id === "string" && typeof m.name === "string" && typeof m.expr === "string" && isValidRollExpr(m.expr))
      .map((m) => ({ id: m.id, name: m.name.trim().slice(0, MAX_MACRO_NAME), expr: m.expr.trim(), secret: m.secret === true }))
      .filter((m) => m.name && !seen.has(m.name) && !!seen.add(m.name))
      .slice(0, MAX_MACROS);
  } catch {
    return [];
  }
}

export function parseOccupations(raw: string | null): Occupation[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    return v
      .filter((o): o is Occupation => !!o && typeof o.id === "string" && typeof o.name === "string" && Array.isArray(o.skills) && checkOccupation(o) === null)
      .map((o) => ({ id: o.id, name: o.name.trim(), formula: o.formula, creditMin: o.creditMin, creditMax: o.creditMax, skills: [...o.skills] }))
      .filter((o) => !seen.has(o.name) && !!seen.add(o.name))
      .slice(0, MAX_OCCUPATIONS);
  } catch {
    return [];
  }
}
