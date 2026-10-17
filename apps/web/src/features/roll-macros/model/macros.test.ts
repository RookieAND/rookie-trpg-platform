import { describe, expect, it } from "vitest";
import { addMacro, isValidExpr, MAX_MACROS, removeMacro } from "./macros";

let n = 0;
const id = () => `m${++n}`;

describe("굴림 매크로", () => {
  it("알아볼 수 있는 식만 받는다", () => {
    expect(isValidExpr("1d6+2")).toBe(true);
    expect(isValidExpr("CC<=60")).toBe(true);
    expect(isValidExpr("")).toBe(false);
    expect(isValidExpr("안녕")).toBe(false);
  });

  it("추가하고 지운다. 이름 중복과 개수 한도는 거절한다", () => {
    let r = addMacro([], { name: " 권총 ", expr: "1d10", secret: false }, id);
    if (!r.ok) throw new Error(r.message);
    expect(r.macros[0]).toMatchObject({ name: "권총", expr: "1d10", secret: false });
    expect(addMacro(r.macros, { name: "권총", expr: "1d6", secret: false }, id).ok).toBe(false);
    expect(addMacro(r.macros, { name: "", expr: "1d6", secret: false }, id).ok).toBe(false);
    expect(addMacro(r.macros, { name: "이상", expr: "ㅁㄴㅇ", secret: false }, id).ok).toBe(false);
    expect(removeMacro(r.macros, r.macros[0]!.id)).toEqual([]);
    let list = r.macros;
    for (let i = 0; list.length < MAX_MACROS; i++) {
      const next = addMacro(list, { name: `m${i}`, expr: "1d6", secret: false }, id);
      if (!next.ok) throw new Error(next.message);
      list = next.macros;
    }
    expect(addMacro(list, { name: "넘침", expr: "1d6", secret: false }, id).ok).toBe(false);
  });
});
