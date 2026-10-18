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

  it("괄호·곱셈·여러 주사위·db 식도 받고, 잘못된 식은 이유를 알려 준다", () => {
    for (const e of ["(2d6+6)*5", "3d6*5", "1d6+1d4", "1d10+db", "d100", "(1d6+1)/2"]) expect(isValidExpr(e), e).toBe(true);
    for (const e of ["(2d6+6", "2d6+", "1001d6", "1d6/0", "5+5", "1d1"]) expect(isValidExpr(e), e).toBe(false);
    const bad = addMacro([], { name: "나눔", expr: "1d6/0", secret: false }, id);
    expect(bad).toMatchObject({ ok: false });
    expect(!bad.ok && bad.message).toBe("굴림 식을 알아볼 수 없어요. 0으로 나눌 수 없어요.");
    const syntax = addMacro([], { name: "괄호", expr: "(2d6+6", secret: false }, id);
    expect(!syntax.ok && syntax.message).toBe("굴림 식을 알아볼 수 없어요. 예: 1d100, CC<=60, (2d6+6)*5");
    const ok = addMacro([], { name: "오백", expr: "(2d6+6)*5", secret: false }, id);
    expect(ok).toMatchObject({ ok: true });
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
