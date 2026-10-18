import { CONDITIONS, CONDITION_LABEL_KO, deriveCharacter, type Character, type Condition } from "./sheet";

/**
 * 부상 규칙(CoC 7판). 순수 함수라서 서버(룸 엔진)와 화면이 같은 기준을 쓴다.
 *
 *  - 한 번에 받은 피해(방어구를 뺀 값)가 최대 HP의 절반 이상이면 중상이다. 최대 HP가 홀수면 올려서 센다
 *    (최대 11이면 6부터). 중상은 즉시 건강 판정(CON)을 해서 실패하면 의식을 잃는다(기절은 GM이 표시).
 *  - HP가 0이 되면 중상이 있는 채로는 빈사(응급처치가 없으면 매 라운드 CON 판정, 실패하면 사망),
 *    중상이 없으면 기절이다.
 *  - 한 번에 받은 피해가 최대 HP 이상(즉사 피해)이면 사망이다. 직접 HP를 고친 경우에는 적용하지 않는다.
 *  - 회복으로 HP가 1 이상이 되면 빈사·기절이 풀리고, HP가 최대 HP의 절반 이상이 되면 중상이 풀린다.
 *  - 사망은 피해·회복으로 되돌지 않는다(GM이 직접 푼다).
 */

export interface VitalState {
  hp: number;
  maxHp: number;
  conditions: readonly Condition[];
}

export type DamageKind = "none" | "wounded" | "major" | "unconscious" | "dying" | "dead";

export interface DamageResult {
  /** 방어구를 뺀 피해 */
  dealt: number;
  absorbed: number;
  hpBefore: number;
  hp: number;
  conditions: Condition[];
  /** 이번 피해로 새로 중상이 됐다 */
  newMajor: boolean;
  /** 즉사 피해(최대 HP 이상) */
  massive: boolean;
  /** 중상을 입고도 HP가 남아 있어서 건강 판정(CON)을 해야 한다 */
  conRoll: boolean;
  /** 가장 무거운 결과 */
  kind: DamageKind;
  /** 이번 피해로 빈사가 새로 시작됐다(라운드 세기를 0으로) */
  startedDying: boolean;
}

const order = (c: Iterable<Condition>): Condition[] => CONDITIONS.filter((k) => new Set(c).has(k));

/** 한 번의 피해가 중상인가: 방어구를 뺀 값이 최대 HP의 절반 이상. */
export const isMajorWoundDamage = (dealt: number, maxHp: number): boolean => dealt > 0 && dealt * 2 >= maxHp;
/** 한 번의 피해가 즉사인가: 최대 HP 이상. */
export const isMassiveDamage = (dealt: number, maxHp: number): boolean => dealt > 0 && maxHp > 0 && dealt >= maxHp;

export interface DamageOptions {
  /** 방어구 값(피해에서 뺀다). 기본 0 */
  armor?: number;
  /** 시트의 HP를 직접 줄인 경우: 즉사 피해를 적용하지 않는다. */
  manual?: boolean;
}

export function applyDamage(state: VitalState, damage: number, opts: DamageOptions = {}): DamageResult {
  const armor = Math.max(0, Math.floor(opts.armor ?? 0));
  const raw = Math.max(0, Math.floor(damage));
  const dealt = Math.max(0, raw - armor);
  const conds = new Set<Condition>(state.conditions);
  const base: DamageResult = {
    dealt,
    absorbed: raw - dealt,
    hpBefore: state.hp,
    hp: state.hp,
    conditions: order(conds),
    newMajor: false,
    massive: false,
    conRoll: false,
    kind: "none",
    startedDying: false,
  };
  if (conds.has("dead") || dealt === 0) return base;

  const hp = Math.max(0, state.hp - dealt);
  if (!opts.manual && isMassiveDamage(dealt, state.maxHp)) {
    return { ...base, hp: 0, conditions: ["dead"], massive: true, kind: "dead" };
  }
  const majorHit = isMajorWoundDamage(dealt, state.maxHp);
  const newMajor = majorHit && !conds.has("majorWound");
  if (majorHit) conds.add("majorWound");
  let kind: DamageKind = majorHit ? "major" : "wounded";
  let startedDying = false;
  if (hp === 0) {
    if (conds.has("majorWound")) {
      startedDying = !conds.has("dying");
      conds.add("dying");
      conds.delete("unconscious");
      kind = "dying";
    } else {
      conds.add("unconscious");
      kind = "unconscious";
    }
  }
  return { ...base, hp, conditions: order(conds), newMajor, conRoll: majorHit && hp > 0, kind, startedDying };
}

export type HealKind = "firstAid" | "natural" | "manual";

export interface HealResult {
  healed: number;
  hpBefore: number;
  hp: number;
  conditions: Condition[];
  /** 이번 회복으로 풀린 상태 */
  cleared: Condition[];
}

/** 응급처치는 HP 1, 그 밖에는 amount만큼 올린다(최대 HP까지). 사망한 캐릭터는 바뀌지 않는다. */
export function applyHealing(state: VitalState, kind: HealKind, amount = 1): HealResult {
  const conds = new Set<Condition>(state.conditions);
  const none: HealResult = { healed: 0, hpBefore: state.hp, hp: state.hp, conditions: order(conds), cleared: [] };
  if (conds.has("dead")) return none;
  const gain = kind === "firstAid" ? 1 : Math.max(0, Math.floor(amount));
  const hp = Math.min(state.maxHp, state.hp + gain);
  const cleared: Condition[] = [];
  if (hp >= 1) {
    for (const k of ["dying", "unconscious"] as const) if (state.hp === 0 && conds.delete(k)) cleared.push(k);
  }
  if (conds.has("majorWound") && hp * 2 >= state.maxHp && hp > state.hp) {
    conds.delete("majorWound");
    cleared.push("majorWound");
  }
  return { healed: hp - state.hp, hpBefore: state.hp, hp, conditions: order(conds), cleared };
}

/** HP를 직접 고쳤을 때: 줄어든 만큼은 피해, 늘어난 만큼은 회복으로 보고 상태를 맞춘다. */
export function applyManualHp(state: VitalState, nextHp: number): { hp: number; conditions: Condition[] } {
  const target = Math.max(0, Math.min(state.maxHp, nextHp));
  if (target < state.hp) {
    const r = applyDamage(state, state.hp - target, { manual: true });
    return { hp: r.hp, conditions: r.conditions };
  }
  if (target > state.hp) {
    const r = applyHealing(state, "manual", target - state.hp);
    return { hp: r.hp, conditions: r.conditions };
  }
  return { hp: state.hp, conditions: order(state.conditions) };
}

// ── 화면용 상태 표시 ─────────────────────────────────────

export type StatusKey = "dead" | "dying" | "unconscious" | "majorWound" | "injured";

export const STATUS_LABEL_KO: Record<StatusKey, string> = {
  dead: CONDITION_LABEL_KO.dead,
  dying: CONDITION_LABEL_KO.dying,
  unconscious: CONDITION_LABEL_KO.unconscious,
  majorWound: CONDITION_LABEL_KO.majorWound,
  injured: "부상",
};

/**
 * 시트와 전투 순서에 붙일 상태 표시(무거운 순). 사망이면 다른 표시는 없고, 빈사는 기절을 포함하니 기절을 따로 안 붙인다.
 * 아무 상태도 없고 HP가 최대보다 낮으면 "부상"이다.
 */
export function statusKeys(c: Pick<Character, "hp" | "conditions" | "characteristics" | "age">): StatusKey[] {
  const conds = new Set(c.conditions ?? []);
  if (conds.has("dead")) return ["dead"];
  const out: StatusKey[] = [];
  if (conds.has("dying")) out.push("dying");
  else if (conds.has("unconscious")) out.push("unconscious");
  if (conds.has("majorWound")) out.push("majorWound");
  if (out.length === 0 && c.hp < deriveCharacter(c).limits.hp) out.push("injured");
  return out;
}

/** 전투 순서 칸에 싣는 상태. 시트가 있는 칸에만 붙는다. */
export interface InitiativeStatus {
  keys: StatusKey[];
}
