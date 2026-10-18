import { describe, expect, it } from "vitest";
import { applyDamage, applyHealing, applyManualHp, isMajorWoundDamage, isMassiveDamage, statusKeys, STATUS_LABEL_KO, type VitalState } from "./wounds";
import type { Character, Condition } from "./sheet";

const vit = (hp: number, maxHp: number, conditions: Condition[] = []): VitalState => ({ hp, maxHp, conditions });

describe("중상·즉사 기준", () => {
  it("중상: 방어구를 뺀 피해 ≥ 최대 HP의 절반 (홀수면 올림)", () => {
    expect(isMajorWoundDamage(5, 12)).toBe(false);
    expect(isMajorWoundDamage(6, 12)).toBe(true);
    expect(isMajorWoundDamage(5, 11)).toBe(false); // 절반 5.5
    expect(isMajorWoundDamage(6, 11)).toBe(true);
    expect(isMajorWoundDamage(5, 10)).toBe(true);
    expect(isMajorWoundDamage(4, 10)).toBe(false);
    expect(isMajorWoundDamage(1, 1)).toBe(true);
    expect(isMajorWoundDamage(0, 10)).toBe(false);
  });
  it("즉사: 한 번의 피해 ≥ 최대 HP", () => {
    expect(isMassiveDamage(11, 12)).toBe(false);
    expect(isMassiveDamage(12, 12)).toBe(true);
    expect(isMassiveDamage(13, 12)).toBe(true);
    expect(isMassiveDamage(0, 12)).toBe(false);
  });
});

describe("applyDamage", () => {
  it("작은 피해는 HP만 깎는다 (부상)", () => {
    expect(applyDamage(vit(12, 12), 3)).toMatchObject({ hp: 9, hpBefore: 12, conditions: [], kind: "wounded", newMajor: false, conRoll: false, massive: false });
  });

  it("중상 경계: 5는 아니고 6은 중상 + 건강 판정", () => {
    expect(applyDamage(vit(12, 12), 5)).toMatchObject({ hp: 7, conditions: [], conRoll: false, kind: "wounded" });
    expect(applyDamage(vit(12, 12), 6)).toMatchObject({ hp: 6, conditions: ["majorWound"], newMajor: true, conRoll: true, kind: "major" });
  });

  it("방어구를 먼저 뺀다 (피해 8, 방어구 3 → 5, 중상 아님)", () => {
    const r = applyDamage(vit(12, 12), 8, { armor: 3 });
    expect(r).toMatchObject({ dealt: 5, absorbed: 3, hp: 7, conditions: [] });
  });

  it("방어구가 피해 이상이면 아무 일도 없다 (최소 0)", () => {
    expect(applyDamage(vit(12, 12), 4, { armor: 4 })).toMatchObject({ dealt: 0, absorbed: 4, hp: 12, kind: "none", conditions: [] });
    expect(applyDamage(vit(12, 12), 4, { armor: 9 })).toMatchObject({ dealt: 0, absorbed: 4, hp: 12, kind: "none" });
  });

  it("HP는 0 아래로 내려가지 않는다", () => {
    expect(applyDamage(vit(3, 12), 5).hp).toBe(0);
  });

  it("HP 0 + 중상 없음 → 기절", () => {
    expect(applyDamage(vit(3, 12), 3)).toMatchObject({ hp: 0, conditions: ["unconscious"], kind: "unconscious", startedDying: false });
  });

  it("HP 0 + 이번 피해로 중상 → 빈사 (기절 아님)", () => {
    const r = applyDamage(vit(7, 12), 7); // 7 ≥ 6 중상, HP 0
    expect(r).toMatchObject({ hp: 0, kind: "dying", startedDying: true, newMajor: true, conRoll: false });
    expect(r.conditions).toEqual(["majorWound", "dying"]);
  });

  it("이미 중상이 있던 캐릭터가 작은 피해로 HP 0 → 빈사", () => {
    const r = applyDamage(vit(2, 12, ["majorWound"]), 2);
    expect(r).toMatchObject({ hp: 0, kind: "dying", startedDying: true, newMajor: false });
    expect(r.conditions).toEqual(["majorWound", "dying"]);
  });

  it("이미 빈사인데 또 맞아도 빈사 시작을 다시 알리지 않는다", () => {
    const r = applyDamage(vit(0, 12, ["majorWound", "dying"]), 2);
    expect(r).toMatchObject({ hp: 0, kind: "dying", startedDying: false });
    expect(r.conditions).toEqual(["majorWound", "dying"]);
  });

  it("기절한 캐릭터가 중상 피해를 받으면 빈사로 바뀐다", () => {
    const r = applyDamage(vit(0, 12, ["unconscious"]), 6);
    expect(r.conditions).toEqual(["majorWound", "dying"]);
    expect(r.startedDying).toBe(true);
  });

  it("기절한 캐릭터가 작은 피해를 또 받으면 그대로 기절", () => {
    expect(applyDamage(vit(0, 12, ["unconscious"]), 1).conditions).toEqual(["unconscious"]);
  });

  it("즉사: 피해 = 최대 HP → 사망, 다른 상태는 지운다", () => {
    const r = applyDamage(vit(12, 12, ["majorWound"]), 12);
    expect(r).toMatchObject({ hp: 0, conditions: ["dead"], massive: true, kind: "dead" });
  });

  it("피해가 최대 HP보다 하나 적으면 즉사가 아니다", () => {
    const r = applyDamage(vit(12, 12), 11);
    expect(r).toMatchObject({ hp: 1, massive: false, kind: "major", conRoll: true });
    expect(r.conditions).toEqual(["majorWound"]);
  });

  it("즉사 판정은 방어구를 뺀 뒤 값으로 한다 (피해 13, 방어구 2, 최대 12 → 11)", () => {
    expect(applyDamage(vit(12, 12), 13, { armor: 2 })).toMatchObject({ massive: false, hp: 1 });
    expect(applyDamage(vit(12, 12), 14, { armor: 2 })).toMatchObject({ massive: true, conditions: ["dead"] });
  });

  it("HP가 모자란 캐릭터도 피해 ≥ 최대 HP면 사망", () => {
    expect(applyDamage(vit(2, 12), 12).conditions).toEqual(["dead"]);
  });

  it("사망한 캐릭터는 바뀌지 않는다", () => {
    const r = applyDamage(vit(0, 12, ["dead"]), 5);
    expect(r).toMatchObject({ hp: 0, conditions: ["dead"], kind: "none", dealt: 5 });
  });

  it("직접 고친 HP(manual)에는 즉사 피해를 적용하지 않는다", () => {
    const r = applyDamage(vit(12, 12), 12, { manual: true });
    expect(r.massive).toBe(false);
    expect(r.hp).toBe(0);
    expect(r.conditions).toEqual(["majorWound", "dying"]);
  });

  it("최대 HP 1인 캐릭터: 1점 피해는 즉사", () => {
    expect(applyDamage(vit(1, 1), 1).conditions).toEqual(["dead"]);
  });

  it("음수·소수 입력은 정수 0 이상으로 다룬다", () => {
    expect(applyDamage(vit(10, 12), -4).hp).toBe(10);
    expect(applyDamage(vit(10, 12), 2.9).hp).toBe(8);
    expect(applyDamage(vit(10, 12), 4, { armor: -2 }).hp).toBe(6);
  });
});

describe("applyHealing", () => {
  it("응급처치는 HP +1 (빈사면 풀린다, 중상은 남는다)", () => {
    const r = applyHealing(vit(0, 12, ["majorWound", "dying"]), "firstAid");
    expect(r).toMatchObject({ hp: 1, healed: 1, conditions: ["majorWound"], cleared: ["dying"] });
  });

  it("HP 0 기절은 HP가 1이 되면 깬다", () => {
    expect(applyHealing(vit(0, 12, ["unconscious"]), "firstAid")).toMatchObject({ hp: 1, conditions: [], cleared: ["unconscious"] });
  });

  it("HP가 이미 있는 기절(건강 판정 실패)은 회복으로 풀리지 않는다", () => {
    expect(applyHealing(vit(5, 12, ["unconscious"]), "natural", 1).conditions).toEqual(["unconscious"]);
  });

  it("응급처치는 amount를 무시하고 1만 올린다", () => {
    expect(applyHealing(vit(3, 12), "firstAid", 5).hp).toBe(4);
  });

  it("중상은 HP가 최대의 절반 이상이 되면 풀린다 (12: 5는 아니고 6은 풀림)", () => {
    expect(applyHealing(vit(4, 12, ["majorWound"]), "natural", 1)).toMatchObject({ hp: 5, conditions: ["majorWound"] });
    expect(applyHealing(vit(4, 12, ["majorWound"]), "natural", 2)).toMatchObject({ hp: 6, conditions: [], cleared: ["majorWound"] });
  });

  it("최대 11이면 6에서 풀린다", () => {
    expect(applyHealing(vit(5, 11, ["majorWound"]), "natural", 1).conditions).toEqual([]);
    expect(applyHealing(vit(4, 11, ["majorWound"]), "natural", 1).conditions).toEqual(["majorWound"]);
  });

  it("빈사에서 한 번에 많이 회복하면 빈사·중상이 함께 풀린다", () => {
    const r = applyHealing(vit(0, 12, ["majorWound", "dying"]), "manual", 8);
    expect(r).toMatchObject({ hp: 8, conditions: [] });
    expect(r.cleared).toEqual(expect.arrayContaining(["dying", "majorWound"]));
  });

  it("최대 HP를 넘지 않는다", () => {
    expect(applyHealing(vit(10, 12), "manual", 50)).toMatchObject({ hp: 12, healed: 2 });
  });

  it("사망한 캐릭터는 회복되지 않는다", () => {
    expect(applyHealing(vit(0, 12, ["dead"]), "firstAid")).toMatchObject({ hp: 0, healed: 0, conditions: ["dead"] });
  });

  it("회복량 0이면 그대로", () => {
    expect(applyHealing(vit(3, 12, ["majorWound"]), "manual", 0)).toMatchObject({ hp: 3, healed: 0, conditions: ["majorWound"] });
  });
});

describe("applyManualHp (시트에서 HP를 직접 고칠 때)", () => {
  it("줄이면 피해처럼, 늘리면 회복처럼 상태가 따라온다", () => {
    expect(applyManualHp(vit(12, 12), 7)).toEqual({ hp: 7, conditions: [] }); // -5, 최대 12 → 중상 아님
    expect(applyManualHp(vit(12, 12), 6)).toEqual({ hp: 6, conditions: ["majorWound"] }); // -6 → 중상
  });
  it("-5는 최대 10에서는 중상", () => {
    expect(applyManualHp(vit(10, 10), 5)).toEqual({ hp: 5, conditions: ["majorWound"] });
  });
  it("0으로 만들면 기절 또는 빈사", () => {
    expect(applyManualHp(vit(2, 12), 0)).toEqual({ hp: 0, conditions: ["unconscious"] });
    expect(applyManualHp(vit(12, 12), 0)).toEqual({ hp: 0, conditions: ["majorWound", "dying"] });
  });
  it("HP 0에서 올리면 기절·빈사가 풀린다", () => {
    expect(applyManualHp(vit(0, 12, ["unconscious"]), 3)).toEqual({ hp: 3, conditions: [] });
  });
  it("같은 값이면 그대로, 범위 밖은 0~최대로 맞춘다", () => {
    expect(applyManualHp(vit(5, 12, ["majorWound"]), 5)).toEqual({ hp: 5, conditions: ["majorWound"] });
    expect(applyManualHp(vit(5, 12), 99).hp).toBe(12);
    expect(applyManualHp(vit(5, 12), -3).hp).toBe(0);
  });
});

describe("statusKeys (시트·전투 칩)", () => {
  const ch = (hp: number, conditions?: Condition[]): Pick<Character, "hp" | "conditions" | "characteristics" | "age"> => ({
    hp,
    ...(conditions ? { conditions } : {}),
    age: 30,
    characteristics: { STR: 50, CON: 60, SIZ: 60, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 }, // 최대 HP 12
  });
  it("멀쩡하면 없다, HP가 깎였으면 부상", () => {
    expect(statusKeys(ch(12))).toEqual([]);
    expect(statusKeys(ch(11))).toEqual(["injured"]);
  });
  it("중상이면 부상 대신 중상", () => {
    expect(statusKeys(ch(5, ["majorWound"]))).toEqual(["majorWound"]);
  });
  it("빈사는 기절을 포함하고 중상과 함께 보인다", () => {
    expect(statusKeys(ch(0, ["majorWound", "dying", "unconscious"]))).toEqual(["dying", "majorWound"]);
  });
  it("기절 + 중상", () => {
    expect(statusKeys(ch(4, ["majorWound", "unconscious"]))).toEqual(["unconscious", "majorWound"]);
  });
  it("사망이면 사망만", () => {
    expect(statusKeys(ch(0, ["dead", "majorWound"]))).toEqual(["dead"]);
  });
  it("한국어 이름", () => {
    expect(STATUS_LABEL_KO).toEqual({ dead: "사망", dying: "빈사", unconscious: "기절", majorWound: "중상", injured: "부상" });
  });
});
