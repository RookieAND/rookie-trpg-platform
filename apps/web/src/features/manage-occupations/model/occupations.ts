import { checkOccupation, MAX_OCCUPATIONS, type Occupation } from "@coc-vtt/shared";

export { MAX_OCCUPATIONS };

export type AddOccupationResult = { ok: true; occupations: Occupation[] } | { ok: false; message: string };

export function addOccupation(list: Occupation[], input: Omit<Occupation, "id">, newId: () => string): AddOccupationResult {
  const problem = checkOccupation(input);
  if (problem) return { ok: false, message: problem };
  if (list.length >= MAX_OCCUPATIONS) return { ok: false, message: `직업은 ${MAX_OCCUPATIONS}개까지 만들 수 있어요.` };
  const name = input.name.trim();
  if (list.some((o) => o.name === name)) return { ok: false, message: "같은 이름의 직업이 있어요." };
  return { ok: true, occupations: [...list, { ...input, name, id: newId() }] };
}

export const removeOccupation = (list: Occupation[], id: string): Occupation[] => list.filter((o) => o.id !== id);
