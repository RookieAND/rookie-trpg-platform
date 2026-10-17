import { describe, expect, it } from "vitest";
import type { Occupation } from "@coc-vtt/shared";
import { addOccupation, exportOccupations, importOccupations, MAX_OCCUPATIONS, removeOccupation, updateOccupation } from "./occupations";

const job = { name: "기자", formula: "edu4" as const, creditMin: 9, creditMax: 30, skills: ["관찰력", "설득"] };
let n = 0;
const id = () => `o${++n}`;

describe("직업 목록", () => {
  it("추가하고 지운다. 잘못된 정의·이름 중복·개수 한도는 거절한다", () => {
    const r = addOccupation([], { ...job, name: " 기자 " }, id);
    if (!r.ok) throw new Error(r.message);
    expect(r.occupations[0]).toMatchObject({ name: "기자", creditMax: 30 });
    expect(addOccupation(r.occupations, job, id)).toMatchObject({ ok: false, message: "같은 이름의 직업이 있어요." });
    expect(addOccupation(r.occupations, { ...job, name: "의사", creditMin: 50 }, id).ok).toBe(false);
    expect(removeOccupation(r.occupations, r.occupations[0]!.id)).toEqual([]);
    let list = r.occupations;
    for (let i = 0; list.length < MAX_OCCUPATIONS; i++) {
      const next = addOccupation(list, { ...job, name: `직업${i}` }, id);
      if (!next.ok) throw new Error(next.message);
      list = next.occupations;
    }
    expect(addOccupation(list, { ...job, name: "넘침" }, id).ok).toBe(false);
  });
});

describe("직업 고치기·내보내기·가져오기", () => {
  const base = (): Occupation[] => {
    const a = addOccupation([], job, id);
    if (!a.ok) throw new Error(a.message);
    const b = addOccupation(a.occupations, { ...job, name: "의사" }, id);
    if (!b.ok) throw new Error(b.message);
    return b.occupations;
  };

  it("고치면 같은 자리에서 바뀌고, 다른 직업과 이름이 겹치거나 규칙에 안 맞으면 거절한다", () => {
    const list = base();
    const r = updateOccupation(list, list[0]!.id, { ...job, creditMax: 40 });
    if (!r.ok) throw new Error(r.message);
    expect(r.occupations[0]).toMatchObject({ id: list[0]!.id, name: "기자", creditMax: 40 });
    expect(updateOccupation(list, list[0]!.id, { ...job, name: "의사" })).toMatchObject({ ok: false });
    expect(updateOccupation(list, list[0]!.id, { ...job, creditMin: 60 }).ok).toBe(false);
    expect(updateOccupation(list, "없음", job).ok).toBe(false);
  });

  it("내보낸 글을 다시 가져오면 같은 정의가 새 id로 들어오고, 이미 있는 이름은 건너뛴다", () => {
    const text = exportOccupations(base());
    expect(text).not.toContain('"id"');
    const fresh = importOccupations([], text, id);
    if (!fresh.ok) throw new Error(fresh.message);
    expect(fresh).toMatchObject({ added: 2, skipped: 0 });
    expect(fresh.occupations.map((o) => o.name)).toEqual(["기자", "의사"]);
    const again = importOccupations(fresh.occupations, text, id);
    expect(again).toMatchObject({ ok: true, added: 0, skipped: 2 });
  });

  it("엉뚱한 파일과 망가진 항목을 안전하게 거른다", () => {
    expect(importOccupations([], "not json", id).ok).toBe(false);
    expect(importOccupations([], JSON.stringify({ kind: "other", occupations: [] }), id).ok).toBe(false);
    const mixed = JSON.stringify({ kind: "coc-vtt-occupations", occupations: [job, { name: "나쁨", formula: "x", creditMin: 0, creditMax: 5, skills: [] }, null, { ...job, name: "스킬이상", skills: ["없는기능"] }] });
    expect(importOccupations([], mixed, id)).toMatchObject({ ok: true, added: 1, skipped: 3 });
  });
});
