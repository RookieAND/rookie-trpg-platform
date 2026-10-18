import { describe, expect, it } from "vitest";
import {
  deriveStats,
  evaluateLevel,
  meetsDifficulty,
  parseCommand,
  parseSumExpression,
  rollExpression,
  rollSumExpression,
  rollPercent,
  type Rng,
} from "./dice";

/** 주어진 값을 순서대로 돌려주는 난수. 값은 [0,1). */
const seq = (...values: number[]): Rng => {
  let i = 0;
  return () => {
    const v = values[i++ % values.length];
    if (v === undefined) throw new Error("empty");
    return v;
  };
};

/** d10(0~9) 한 칸을 고르는 값 */
const d10 = (n: number) => (n + 0.05) / 10;
/** d100 결과 n(1~100)을 만드는 단일 굴림 */
const d100 = (n: number) => (n - 1 + 0.5) / 100;

describe("evaluateLevel", () => {
  it("목표 60: 단계 경계값", () => {
    expect(evaluateLevel(1, 60)).toBe("critical");
    expect(evaluateLevel(12, 60)).toBe("extreme");
    expect(evaluateLevel(13, 60)).toBe("hard");
    expect(evaluateLevel(30, 60)).toBe("hard");
    expect(evaluateLevel(31, 60)).toBe("regular");
    expect(evaluateLevel(60, 60)).toBe("regular");
    expect(evaluateLevel(61, 60)).toBe("failure");
    expect(evaluateLevel(99, 60)).toBe("failure");
    expect(evaluateLevel(100, 60)).toBe("fumble");
  });

  it("목표 50 미만이면 96 이상이 대실패", () => {
    expect(evaluateLevel(95, 49)).toBe("failure");
    expect(evaluateLevel(96, 49)).toBe("fumble");
    expect(evaluateLevel(96, 50)).toBe("failure");
  });

  it("목표 1이면 1은 대성공이고 나머지는 실패", () => {
    expect(evaluateLevel(1, 1)).toBe("critical");
    expect(evaluateLevel(2, 1)).toBe("failure");
  });

  it("난이도 충족 판정", () => {
    expect(meetsDifficulty("hard", "regular")).toBe(true);
    expect(meetsDifficulty("regular", "hard")).toBe(false);
    expect(meetsDifficulty("critical", "extreme")).toBe(true);
    expect(meetsDifficulty("extreme", "critical")).toBe(false);
  });
});

describe("rollPercent", () => {
  it("보너스 없음: 10의 자리 1개", () => {
    const r = rollPercent(seq(d10(4), d10(3)), 0); // units=4, tens=3
    expect(r.tens).toEqual([3]);
    expect(r.total).toBe(34);
  });

  it("보너스 1: 낮은 10의 자리를 고른다", () => {
    const r = rollPercent(seq(d10(5), d10(7), d10(2)), 1); // units=5, tens=[7,2]
    expect(r.total).toBe(25);
  });

  it("페널티 1: 높은 10의 자리를 고른다", () => {
    const r = rollPercent(seq(d10(5), d10(7), d10(2)), -1);
    expect(r.total).toBe(75);
  });

  it("보너스 최대 2개로 제한한다", () => {
    const r = rollPercent(seq(d10(0), d10(9), d10(8), d10(7), d10(6)), 5);
    expect(r.bonus).toBe(2);
    expect(r.tens).toHaveLength(3);
  });

  it("00과 0은 100이다", () => {
    expect(rollPercent(seq(d10(0), d10(0)), 0).total).toBe(100);
  });

  it("보너스가 있어도 00과 0이 100이면 다른 10의 자리를 고른다", () => {
    // units=0, tens=[0,5] → 100과 50 중 낮은 50
    expect(rollPercent(seq(d10(0), d10(0), d10(5)), 1).total).toBe(50);
  });
});

describe("parseCommand", () => {
  it.each([
    ["1d100", { kind: "dice", count: 1, sides: 100, modifier: 0 }],
    ["2D6+3", { kind: "dice", count: 2, sides: 6, modifier: 3 }],
    ["1d8-1", { kind: "dice", count: 1, sides: 8, modifier: -1 }],
    ["CC", { kind: "cc", bonus: 0 }],
    ["CC<=30", { kind: "cc", bonus: 0, target: 30 }],
    ["CC(2)<=50", { kind: "cc", bonus: 2, target: 50 }],
    ["CC(+2)<=50", { kind: "cc", bonus: 2, target: 50 }],
    ["CC(-1)<=75", { kind: "cc", bonus: -1, target: 75 }],
    ["CC-1<=50", { kind: "cc", bonus: -1, target: 50 }],
    ["CC1<=65", { kind: "cc", bonus: 1, target: 65 }],
    ["CC+1<=65", { kind: "cc", bonus: 1, target: 65 }],
    ["CC<=70r", { kind: "cc", bonus: 0, target: 70, difficulty: "regular" }],
    ["CC1<=60h", { kind: "cc", bonus: 1, target: 60, difficulty: "hard" }],
    ["CC-2<=50e", { kind: "cc", bonus: -2, target: 50, difficulty: "extreme" }],
    ["CC2<=99c", { kind: "cc", bonus: 2, target: 99, difficulty: "critical" }],
    ["CBR(50,20)", { kind: "cbr", x: 50, y: 20 }],
    ["cc <= 60", { kind: "cc", bonus: 0, target: 60 }],
  ])("BCDice 예시 %s", (input, expected) => {
    const r = parseCommand(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command).toEqual(expected);
  });

  it.each(["", "ccb<=60", "hello", "0d6", "1d1", "101d6", "CCh", "CC<=", "2d6*3"])(
    "잘못된 식 %j",
    (input) => {
      expect(parseCommand(input).ok).toBe(false);
    },
  );
});

describe("rollExpression", () => {
  it("2d6+3", () => {
    const r = rollExpression("2d6+3", seq(0.0, 0.99)); // 1, 6
    expect(r.ok).toBe(true);
    if (r.ok && r.outcome.kind === "dice") {
      expect(r.outcome.rolls).toEqual([1, 6]);
      expect(r.outcome.total).toBe(10);
    }
  });

  it("CC<=60 결과 단계", () => {
    // units=3, tens=2 → 23
    const r = rollExpression("CC<=60", seq(d10(3), d10(2)));
    expect(r.ok).toBe(true);
    if (r.ok && r.outcome.kind === "cc") {
      expect(r.outcome.percent.total).toBe(23);
      expect(r.outcome.level).toBe("hard");
      expect(r.outcome.success).toBe(true);
    }
  });

  it("난이도 h에서 일반 성공은 실패 처리", () => {
    // 45 → regular
    const r = rollExpression("CC<=60h", seq(d10(5), d10(4)));
    if (r.ok && r.outcome.kind === "cc") {
      expect(r.outcome.level).toBe("regular");
      expect(r.outcome.success).toBe(false);
    }
  });

  it("목표값이 없으면 d100만 보여 준다", () => {
    const r = rollExpression("CC", seq(d10(0), d10(0)));
    if (r.ok && r.outcome.kind === "cc") {
      expect(r.outcome.percent.total).toBe(100);
      expect(r.outcome.level).toBeUndefined();
    }
  });

  it("CBR 조합 판정", () => {
    const r = rollExpression("CBR(50,20)", seq(d100(30)));
    if (r.ok && r.outcome.kind === "cbr") {
      expect(r.outcome.roll).toBe(30);
      expect(r.outcome.x.level).toBe("regular");
      expect(r.outcome.y.level).toBe("failure");
      expect(r.outcome.successes).toBe(1);
    }
  });

  it("잘못된 식은 오류를 돌려준다", () => {
    expect(rollExpression("ccb<=60")).toMatchObject({ ok: false });
  });
});

describe("deriveStats", () => {
  const base = { STR: 45, CON: 60, SIZ: 50, DEX: 60, APP: 50, INT: 75, POW: 60, EDU: 80 };

  it("시안의 윤서하 수치와 일치한다", () => {
    expect(deriveStats(base, 28)).toEqual({
      hp: 11,
      mp: 12,
      san: 60,
      mov: 8,
      damageBonus: "0",
      build: 0,
    });
  });

  it("이동력: 둘 다 SIZ보다 작으면 7, 둘 다 크면 9", () => {
    expect(deriveStats({ ...base, STR: 40, DEX: 40 }, 20).mov).toBe(7);
    expect(deriveStats({ ...base, STR: 60, DEX: 60 }, 20).mov).toBe(9);
  });

  it("40세부터 10년마다 이동력 1 감소", () => {
    expect(deriveStats(base, 39).mov).toBe(8);
    expect(deriveStats(base, 40).mov).toBe(7);
    expect(deriveStats(base, 50).mov).toBe(6);
  });

  it("피해 보너스와 체격 경계", () => {
    expect(deriveStats({ ...base, STR: 14, SIZ: 50 }, 20)).toMatchObject({ damageBonus: "-2", build: -2 });
    expect(deriveStats({ ...base, STR: 25, SIZ: 50 }, 20)).toMatchObject({ damageBonus: "-1", build: -1 });
    expect(deriveStats({ ...base, STR: 74, SIZ: 50 }, 20)).toMatchObject({ damageBonus: "0", build: 0 });
    expect(deriveStats({ ...base, STR: 90, SIZ: 70 }, 20)).toMatchObject({ damageBonus: "1d4", build: 1 });
    expect(deriveStats({ ...base, STR: 90, SIZ: 100 }, 20)).toMatchObject({ damageBonus: "1d6", build: 2 });
  });
});

describe("합산 식(parseSumExpression, rollSumExpression)", () => {
  it("항을 더해 굴리고 rolls·modifier를 나눠 돌려준다", () => {
    const r = rollSumExpression("1d6+1d4+2", seq(0.5, 0.99));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.outcome).toMatchObject({ kind: "dice", rolls: [4, 4], modifier: 2, total: 10 });
  });
  it("2d6, 1d10+2, 단일 항(기존 데이터)도 그대로 된다", () => {
    expect(rollSumExpression("2d6", seq(0, 0.99))).toMatchObject({ ok: true, outcome: { total: 7 } });
    expect(rollSumExpression("1d10+2", seq(0.99))).toMatchObject({ ok: true, outcome: { total: 12 } });
    expect(rollSumExpression("1d6", seq(0.5))).toMatchObject({ ok: true, outcome: { total: 4, rolls: [4], modifier: 0 } });
    expect(rollSumExpression(" 1D6 + 1d4 ", seq(0, 0))).toMatchObject({ ok: true, outcome: { total: 2 } });
  });
  it("상수는 뺄 수 있다", () => {
    expect(rollSumExpression("1d6+1d4-1", seq(0.99, 0.99))).toMatchObject({ ok: true, outcome: { total: 9 } });
  });
  it("잘못된 식은 거절한다", () => {
    for (const bad of ["", "abc", "CC<=50", "CBR(50,50)", "5", "+2", "1d6+", "1d6++2", "1d6+abc", "1d0", "1d1", "1d6-1d4", "1d6+CC", "1d6,1d4", "101d6", "1d6+100d6", "1d1001", "1d6*2"]) {
      expect(parseSumExpression(bad).ok, bad).toBe(false);
    }
  });
  it("주사위 총 개수와 식 길이는 기존 굴림 상한을 따른다", () => {
    expect(parseSumExpression("50d6+50d6").ok).toBe(true);
    expect(parseSumExpression("50d6+51d6").ok).toBe(false);
    expect(parseSumExpression(Array(40).fill("1d6").join("+")).ok).toBe(false); // 길이 64 초과
    expect(parseSumExpression(Array(16).fill("1d6").join("+")).ok).toBe(true);
  });
});
