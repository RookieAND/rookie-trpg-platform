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

/** 정의를 고친다. 이름은 다른 직업과 겹치면 안 된다(자기 자신은 괜찮다). */
export function updateOccupation(list: Occupation[], id: string, input: Omit<Occupation, "id">): AddOccupationResult {
  const problem = checkOccupation(input);
  if (problem) return { ok: false, message: problem };
  const name = input.name.trim();
  if (list.some((o) => o.id !== id && o.name === name)) return { ok: false, message: "같은 이름의 직업이 있어요." };
  if (!list.some((o) => o.id === id)) return { ok: false, message: "고칠 직업을 찾지 못했어요." };
  return { ok: true, occupations: list.map((o) => (o.id === id ? { ...input, name, id } : o)) };
}

const FILE_KIND = "coc-vtt-occupations";

/** 내 직업 정의를 다른 사람에게 줄 수 있는 파일 글로 만든다. */
export const exportOccupations = (list: Occupation[]): string =>
  JSON.stringify({ kind: FILE_KIND, version: 1, occupations: list.map(({ id: _id, ...o }) => o) }, null, 2);

export type ImportResult = { ok: true; occupations: Occupation[]; added: number; skipped: number } | { ok: false; message: string };

/** 파일 글을 읽어 내 목록에 더한다. 규칙에 안 맞거나 이름이 겹치는 것, 한도를 넘는 것은 건너뛴다. */
export function importOccupations(list: Occupation[], text: string, newId: () => string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: "직업 정의 파일이 아니에요." };
  }
  const items = (data as { kind?: unknown; occupations?: unknown } | null)?.kind === FILE_KIND ? (data as { occupations?: unknown }).occupations : null;
  if (!Array.isArray(items)) return { ok: false, message: "직업 정의 파일이 아니에요." };
  const out = [...list];
  let added = 0;
  for (const raw of items) {
    const o = raw as Partial<Omit<Occupation, "id">> | null;
    if (!o || typeof o.name !== "string" || !Array.isArray(o.skills) || !o.skills.every((s) => typeof s === "string")) continue;
    const input = { name: o.name, formula: o.formula as Occupation["formula"], creditMin: o.creditMin as number, creditMax: o.creditMax as number, skills: o.skills };
    const r = out.length >= MAX_OCCUPATIONS ? null : addOccupation(out, input, newId);
    if (r?.ok) (out.length = 0), out.push(...r.occupations), added++;
  }
  return { ok: true, occupations: out, added, skipped: items.length - added };
}
