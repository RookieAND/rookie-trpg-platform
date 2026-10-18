import { describe, expect, it } from "vitest";
import {
  MAX_DICE_TERMS,
  MAX_DICE_TOTAL,
  MAX_DIE_SIDES,
  MAX_EXPR_LENGTH,
  MAX_PAREN_DEPTH,
  evaluateDiceExpression,
  parseDiceExpression,
  simplifyDice,
} from "./expr";
import { parseCommand, rollExpression, type Rng } from "./dice";

/** 주어진 값을 순서대로 돌려준다. 눈 n(1~sides)은 (n-0.5)/sides로 만든다. */
const seq = (...v: number[]): Rng => {
  let i = 0;
  return () => v[i++ % v.length]!;
};
const face = (n: number, sides: number) => (n - 0.5) / sides;

const roll = (input: string, rng: Rng, damageBonus?: string) => {
  const p = parseDiceExpression(input);
  if (!p.ok) throw new Error(p.error);
  return evaluateDiceExpression(p, rng, damageBonus);
};
const parseError = (input: string) => {
  const p = parseDiceExpression(input);
  return p.ok ? null : p.error;
};

describe("식 읽기", () => {
  it.each(["d100", "1d6+1d4", "2d6+6", "(2d6+6)*5", "3d6*5", "1d10+db", "D100", " 1D6 + 2 ", "((1d6))", "-1d4+5", "2*(1d6+1)", "(1d6+1)/2", "db", "1d6+db*2", "1d6-1d4", "5+1d6"])(
    "받는 식 %j",
    (input) => {
      expect(parseError(input)).toBeNull();
    },
  );

  it.each([
    ["", "비어"],
    ["   ", "비어"],
    ["abc", "읽지"],
    ["2d6+", "읽지"],
    ["(2d6", "읽지"],
    ["2d6)", "읽지"],
    ["()", "읽지"],
    ["2d6**3", "읽지"],
    ["2d6 3d6", "읽지"],
    ["1d6;1d4", "읽지"],
    ["1d6+eval(1)", "읽지"],
    ["2db", "읽지"],
    ["d", "읽지"],
    ["1.5d6", "읽지"],
    ["5", "주사위가 하나"],
    ["(2+3)*4", "주사위가 하나"],
    ["1d6/0", "0으로"],
    ["0d6", "1~"],
    ["1d1", "면 수"],
    ["1d0", "면 수"],
    ["1d10001", "면 수"],
    ["1001d6", "1000"],
    ["99999d6", "합쳐"],
    ["600d6+401d6", "합쳐"],
    ["1d6+9999999999", "너무 커"],
  ])("거절하는 식 %j → %s", (input, part) => {
    expect(parseError(input)).toContain(part);
  });

  it("상한 경계: 주사위 1000개·면 10000은 되고 넘으면 안 된다", () => {
    expect(parseError(`${MAX_DICE_TOTAL}d${MAX_DIE_SIDES}`)).toBeNull();
    expect(parseError(`${MAX_DICE_TOTAL + 1}d6`)).not.toBeNull();
    expect(parseError(`1d${MAX_DIE_SIDES + 1}`)).not.toBeNull();
    expect(parseError(`500d6+500d6`)).toBeNull();
    expect(parseError(`500d6+500d6+1d6`)).toContain("합쳐");
  });

  it("주사위 항은 100개까지", () => {
    const terms = (n: number) => Array(n).fill("d6").join("+");
    expect(terms(MAX_DICE_TERMS).length).toBeLessThanOrEqual(MAX_EXPR_LENGTH);
    expect(parseError(terms(MAX_DICE_TERMS))).toBeNull();
    expect(parseError(terms(MAX_DICE_TERMS + 1))).toContain("항");
  });

  it("식 길이 상한", () => {
    expect(parseError("1d6+" + "1".repeat(MAX_EXPR_LENGTH))).toContain(`${MAX_EXPR_LENGTH}자`);
    expect(parseError(" ".repeat(10) + "1d6")).toBeNull(); // 공백은 길이에 영향이 적다
  });

  it("괄호는 8겹까지", () => {
    const nest = (n: number) => "(".repeat(n) + "1d6" + ")".repeat(n);
    expect(parseError(nest(MAX_PAREN_DEPTH))).toBeNull();
    expect(parseError(nest(MAX_PAREN_DEPTH + 1))).toContain("괄호");
    expect(parseError("-".repeat(50) + "1d6")).not.toBeNull(); // 앞의 마이너스를 끝없이 쌓는 식도 막는다
  });

  it("긴 괄호·마이너스 입력이 호출 스택을 터뜨리지 않는다", () => {
    expect(() => parseDiceExpression("(".repeat(5000))).not.toThrow();
    expect(() => parseDiceExpression("-".repeat(5000) + "1d6")).not.toThrow();
  });
});

describe("simplifyDice", () => {
  it("주사위 하나와 숫자뿐인 덧셈·뺄셈만 줄인다", () => {
    const flat = (s: string) => {
      const p = parseDiceExpression(s);
      return p.ok ? simplifyDice(p.ast) : "err";
    };
    expect(flat("2d6+3")).toEqual({ count: 2, sides: 6, modifier: 3 });
    expect(flat("d100")).toEqual({ count: 1, sides: 100, modifier: 0 });
    expect(flat("1d6-2")).toEqual({ count: 1, sides: 6, modifier: -2 });
    expect(flat("1d6+2+3")).toEqual({ count: 1, sides: 6, modifier: 5 });
    expect(flat("3+1d6")).toEqual({ count: 1, sides: 6, modifier: 3 });
    expect(flat("1d6*2")).toBeNull();
    expect(flat("(1d6)")).toBeNull();
    expect(flat("1d6+1d4")).toBeNull();
    expect(flat("-1d6")).toBeNull();
    expect(flat("5-1d6")).toBeNull();
  });
  it("parseCommand: 단순한 식은 dice, 나머지는 expr", () => {
    expect(parseCommand("2d6+6")).toMatchObject({ ok: true, command: { kind: "dice", count: 2, sides: 6, modifier: 6 } });
    expect(parseCommand("(2d6+6)*5")).toMatchObject({ ok: true, command: { kind: "expr" } });
    expect(parseCommand("1d10+db")).toMatchObject({ ok: true, command: { kind: "expr" } });
    expect(parseCommand("1d6+1d4")).toMatchObject({ ok: true, command: { kind: "expr" } });
  });
});

describe("굴리기 (눈을 고정한 난수)", () => {
  it("(2d6+6)*5: 눈 1, 6 → 65", () => {
    const r = roll("(2d6+6)*5", seq(face(1, 6), face(6, 6)));
    expect(r).toMatchObject({ ok: true, total: 65, rolls: [1, 6], breakdown: "(2d6[1,6]+6)*5" });
    expect(r.ok && r.terms).toEqual([{ text: "2d6", rolls: [1, 6], sum: 7 }]);
  });

  it("3d6*5: 눈 6, 6, 6 → 90 / 눈 1, 1, 1 → 15", () => {
    expect(roll("3d6*5", seq(face(6, 6)))).toMatchObject({ total: 90, rolls: [6, 6, 6] });
    expect(roll("3d6*5", seq(face(1, 6)))).toMatchObject({ total: 15 });
  });

  it("1d6+1d4는 항별 결과를 남긴다", () => {
    const r = roll("1d6+1d4", seq(face(3, 6), face(4, 4)));
    expect(r).toMatchObject({ ok: true, total: 7, rolls: [3, 4], breakdown: "1d6[3]+1d4[4]" });
    expect(r.ok && r.terms).toEqual([
      { text: "1d6", rolls: [3], sum: 3 },
      { text: "1d4", rolls: [4], sum: 4 },
    ]);
  });

  it("d100은 1d100과 같다", () => {
    expect(roll("d100", seq(face(37, 100)))).toMatchObject({ total: 37, rolls: [37] });
  });

  it("연산 우선순위와 왼쪽 결합", () => {
    // 눈 4: 4+2*3=10, (4+2)*3=18, 4-2-1=1, 8/2/2=2
    const four = () => face(4, 6);
    expect(roll("1d6+2*3", four)).toMatchObject({ total: 10 });
    expect(roll("(1d6+2)*3", four)).toMatchObject({ total: 18 });
    expect(roll("1d6-2-1", four)).toMatchObject({ total: 1 });
    expect(roll("2d6/2/2", four)).toMatchObject({ total: 2 });
  });

  it("나눗셈은 내림 정수 (음수도 아래로)", () => {
    expect(roll("(1d6+6)/2", seq(face(1, 6)))).toMatchObject({ total: 3 }); // 7/2
    expect(roll("(1d6-10)/4", seq(face(1, 6)))).toMatchObject({ total: -3 }); // -9/4 = -2.25 → -3
  });

  it("앞의 마이너스와 항 전체 빼기", () => {
    expect(roll("-1d4+5", seq(face(3, 4)))).toMatchObject({ total: 2 });
    expect(roll("10-1d6", seq(face(4, 6)))).toMatchObject({ total: 6 });
  });

  it("0으로 나누는 값은 굴린 뒤 알려 준다", () => {
    const r = roll("1d6/(1d6-1)", seq(face(1, 6)));
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain("0으로");
  });

  it("결과 크기 상한 (곱해서 10억을 넘으면 거절)", () => {
    const r = roll("(1000d10000)*100000", seq(0.99999));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("너무 커");
    expect(roll("(500d10000)*100", seq(0.99999)).ok).toBe(true); // 5천만 × 100 = 50억이 아니라 5,000,000×100=5억
  });

  it("눈 많은 굴림은 계산식에 합만 적는다", () => {
    const r = roll("30d6", seq(face(2, 6)));
    expect(r).toMatchObject({ ok: true, total: 60 });
    expect(r.ok && r.breakdown).toBe("30d6[30개, 합 60]");
    expect(r.ok && r.rolls).toHaveLength(30);
  });

  it("경계 눈: 난수 0은 1, 0.999…는 면 수", () => {
    expect(roll("d6", () => 0)).toMatchObject({ total: 1 });
    expect(roll("d6", () => 0.9999999)).toMatchObject({ total: 6 });
    expect(roll("d10000", () => 0.9999999)).toMatchObject({ total: 10000 });
  });
});

describe("db(피해 보너스)", () => {
  it("주사위 보너스: 1d10+db(1d4)", () => {
    const r = roll("1d10+db", seq(face(7, 10), face(3, 4)), "1d4");
    expect(r).toMatchObject({ ok: true, total: 10, rolls: [7, 3], breakdown: "1d10[7]+db(1d4[3])" });
    expect(r.ok && r.terms).toEqual([
      { text: "1d10", rolls: [7], sum: 7 },
      { text: "db(1d4)", rolls: [3], sum: 3 },
    ]);
  });

  it("2d6 보너스와 음수·0 보너스", () => {
    expect(roll("1d6+db", seq(face(2, 6), face(5, 6), face(6, 6)), "2d6")).toMatchObject({ total: 13 });
    expect(roll("1d6+db", seq(face(5, 6)), "-2")).toMatchObject({ total: 3 });
    expect(roll("1d6+db", seq(face(5, 6)), "-1")).toMatchObject({ total: 4 });
    expect(roll("1d6+db", seq(face(5, 6)), "0")).toMatchObject({ total: 5 });
    expect(roll("1d6+db", seq(face(5, 6)), "")).toMatchObject({ total: 5 });
  });

  it("db에 곱셈·나눗셈 (2d6+db/2)", () => {
    expect(roll("1d6+db/2", seq(face(2, 6), face(3, 4)), "1d4")).toMatchObject({ total: 3 });
  });

  it("피해 보너스를 모르면 알려 준다", () => {
    const r = roll("1d6+db", seq(0.5));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("db");
  });

  it("엉뚱한 피해 보너스 문자열은 거절한다", () => {
    expect(roll("1d6+db", seq(0.5), "abc")).toMatchObject({ ok: false });
    expect(roll("1d6+db", seq(0.5), "db")).toMatchObject({ ok: false });
  });

  it("db의 주사위도 총 개수 상한에 들어간다", () => {
    const r = roll("999d6+db+db", seq(0.5), "1d6");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("합쳐");
  });

  it("rollExpression: 한 번에 해석해 굴리고 dice 결과로 돌려준다 (modifier = 합계 − 눈의 합)", () => {
    const r = rollExpression("(2d6+6)*5", seq(face(1, 6), face(6, 6)));
    expect(r).toMatchObject({ ok: true, outcome: { kind: "dice", total: 65, rolls: [1, 6], modifier: 58, breakdown: "(2d6[1,6]+6)*5" } });
    expect(rollExpression("1d10+db", seq(0.5), undefined)).toMatchObject({ ok: false });
    expect(rollExpression("1d10+db", seq(face(5, 10), face(2, 4)), { damageBonus: "1d4" })).toMatchObject({ ok: true, outcome: { total: 7 } });
  });

  it("단순한 식은 예전 모양 그대로 (terms·breakdown 없음)", () => {
    const r = rollExpression("2d6+3", seq(face(1, 6), face(6, 6)));
    expect(r).toEqual({ ok: true, outcome: { kind: "dice", expr: "2d6+3", rolls: [1, 6], modifier: 3, total: 10 } });
  });
});
