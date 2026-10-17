import { describe, expect, it } from "vitest";
import { addOccupation, MAX_OCCUPATIONS, removeOccupation } from "./occupations";

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
