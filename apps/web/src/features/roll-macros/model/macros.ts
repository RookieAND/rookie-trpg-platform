import { isValidRollExpr, MAX_MACRO_NAME, MAX_MACROS, parseCommand, type Macro } from "@coc-vtt/shared";

export { MAX_MACROS, MAX_MACRO_NAME, type Macro };
export const isValidExpr = isValidRollExpr;

export type AddResult = { ok: true; macros: Macro[] } | { ok: false; message: string };

export function addMacro(list: Macro[], input: { name: string; expr: string; secret: boolean }, newId: () => string): AddResult {
  const name = input.name.trim();
  if (!name) return { ok: false, message: "이름을 적어 주세요." };
  if (name.length > MAX_MACRO_NAME) return { ok: false, message: `이름은 ${MAX_MACRO_NAME}자까지예요.` };
  if (!isValidExpr(input.expr)) {
    const p = parseCommand(input.expr);
    const detail = !p.ok && !p.error.startsWith("식을 읽지") && !p.error.includes("비어") ? ` ${p.error}` : "";
    return { ok: false, message: `굴림 식을 알아볼 수 없어요.${detail || " 예: 1d100, CC<=60, (2d6+6)*5"}` };
  }
  if (list.length >= MAX_MACROS) return { ok: false, message: `매크로는 ${MAX_MACROS}개까지 만들 수 있어요.` };
  if (list.some((m) => m.name === name)) return { ok: false, message: "같은 이름의 매크로가 있어요." };
  return { ok: true, macros: [...list, { id: newId(), name, expr: input.expr.trim(), secret: input.secret }] };
}

export const removeMacro = (list: Macro[], id: string): Macro[] => list.filter((m) => m.id !== id);
