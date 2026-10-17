import { describe, expect, it } from "vitest";
import { isDamageExpr, weaponSchema } from "./protocol";

describe("무기 피해 식", () => {
  it("주사위, +db, 고정값을 받는다", () => {
    for (const t of ["1d6", "1d8+2", "1d6+db", "1D4+DB", "5"]) expect(isDamageExpr(t)).toBe(true);
  });
  it("엉뚱한 식은 거절한다", () => {
    for (const t of ["", "abc", "1d0", "db"]) expect(isDamageExpr(t)).toBe(false);
  });
  it("weaponSchema가 같은 규칙을 쓴다", () => {
    expect(weaponSchema.safeParse({ name: "권총", skill: "사격(권총)", damage: "1d10" }).success).toBe(true);
    expect(weaponSchema.safeParse({ name: "권총", skill: "사격(권총)", damage: "펑" }).success).toBe(false);
  });
});
