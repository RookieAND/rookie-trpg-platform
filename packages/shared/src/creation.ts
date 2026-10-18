import { rollDie, type Characteristics } from "./dice";
import type { CharacterInput } from "./protocol";
import { CHARACTERISTIC_KEYS, defaultSkillValues, type CharacteristicKey } from "./sheet";

/** CoC 7판 캐릭터 생성 규칙(나이 보정, 기능 포인트). 생성 마법사가 쓰고, 화면과 무관하게 테스트한다. */

export interface AgeRules {
  /** 이 중에서 합계가 physicalPenalty가 되도록 깎는다 */
  physicalKeys: CharacteristicKey[];
  physicalPenalty: number;
  appPenalty: number;
  eduPenalty: number;
  /** 교육 향상 판정 횟수 */
  eduChecks: number;
  /** 행운을 두 번 굴려 높은 쪽을 쓴다 */
  luckTwice: boolean;
}

export function ageRules(age: number): AgeRules {
  if (age < 20) return { physicalKeys: ["STR", "SIZ"], physicalPenalty: 5, appPenalty: 0, eduPenalty: 5, eduChecks: 0, luckTwice: true };
  const mid: CharacteristicKey[] = ["STR", "CON", "DEX"];
  const none = { physicalKeys: [] as CharacteristicKey[], physicalPenalty: 0, appPenalty: 0, eduPenalty: 0, luckTwice: false };
  if (age < 40) return { ...none, eduChecks: 1 };
  if (age < 50) return { physicalKeys: mid, physicalPenalty: 5, appPenalty: 5, eduPenalty: 0, eduChecks: 2, luckTwice: false };
  if (age < 60) return { physicalKeys: mid, physicalPenalty: 10, appPenalty: 10, eduPenalty: 0, eduChecks: 3, luckTwice: false };
  if (age < 70) return { physicalKeys: mid, physicalPenalty: 20, appPenalty: 15, eduPenalty: 0, eduChecks: 4, luckTwice: false };
  if (age < 80) return { physicalKeys: mid, physicalPenalty: 40, appPenalty: 20, eduPenalty: 0, eduChecks: 4, luckTwice: false };
  return { physicalKeys: mid, physicalPenalty: 80, appPenalty: 25, eduPenalty: 0, eduChecks: 4, luckTwice: false };
}

/** 행운: 3d6×5. 어리면 두 번 굴려 높은 쪽. */
export function rollLuckFor(age: number, rng: () => number): number {
  const once = () => (rollDie(rng, 6) + rollDie(rng, 6) + rollDie(rng, 6)) * 5;
  return ageRules(age).luckTwice ? Math.max(once(), once()) : once();
}

/** 신체 감소분을 나눈 값이 규칙에 맞는지 본다. 맞으면 null, 아니면 이유. */
export function checkAgeAdjustment(rules: AgeRules, cut: Partial<Record<CharacteristicKey, number>>): string | null {
  let sum = 0;
  for (const k of CHARACTERISTIC_KEYS) {
    const v = cut[k] ?? 0;
    if (!Number.isInteger(v) || v < 0) return "깎는 값은 0 이상의 정수여야 해요.";
    if (v > 0 && !rules.physicalKeys.includes(k)) return `${k}는 깎을 수 없어요.`;
    sum += v;
  }
  if (sum !== rules.physicalPenalty) return `${rules.physicalKeys.join("·")}에서 합계 ${rules.physicalPenalty}만큼 깎아야 해요. (지금 ${sum})`;
  return null;
}

/** 교육 향상 판정: 현재 EDU보다 d100이 크면 EDU가 1d10 오른다(최대 99). */
export function eduImprovement(edu: number, checks: number, rng: () => number): { edu: number; steps: Array<{ roll: number; gain: number }> } {
  let cur = edu;
  const steps: Array<{ roll: number; gain: number }> = [];
  for (let i = 0; i < checks; i++) {
    const roll = rollDie(rng, 100);
    const gain = roll > cur ? rollDie(rng, 10) : 0;
    cur = Math.min(99, cur + gain);
    steps.push({ roll, gain });
  }
  return { edu: cur, steps };
}

/** 굴린 특성치에 나이 보정을 적용한다. eduGain은 교육 향상 판정으로 오른 만큼이다. */
export function applyAge(base: Characteristics, rules: AgeRules, cut: Partial<Record<CharacteristicKey, number>>, eduGain = 0): Characteristics {
  const out = { ...base };
  for (const k of CHARACTERISTIC_KEYS) out[k] = out[k] - (cut[k] ?? 0);
  out.APP -= rules.appPenalty;
  out.EDU = out.EDU - rules.eduPenalty + eduGain;
  for (const k of CHARACTERISTIC_KEYS) out[k] = Math.min(99, Math.max(1, out[k]));
  return out;
}

// ── 직업 정의 ─────────────────────────────────────────────

export const CREDIT_RATING = "신용도";
export const MAX_OCCUPATION_SKILLS = 12;

/** 사용자가 정하는 직업: 직업 포인트 공식, 신용도 범위, 직업 기능 목록. */
export interface Occupation {
  id: string;
  name: string;
  formula: OccupationFormulaId;
  creditMin: number;
  creditMax: number;
  /** 직업 포인트를 쓸 수 있는 기능(신용도는 늘 포함이라 적지 않는다) */
  skills: string[];
}

/** 직업 정의가 쓸 수 있는 모양인지 본다. 맞으면 null, 아니면 이유. */
export function checkOccupation(o: Omit<Occupation, "id">): string | null {
  const name = o.name.trim();
  if (!name) return "직업 이름을 적어 주세요.";
  if (name.length > 40) return "직업 이름은 40자까지예요.";
  if (!OCCUPATION_POINT_FORMULAS.some((f) => f.id === o.formula)) return "직업 포인트 공식을 골라 주세요.";
  if (![o.creditMin, o.creditMax].every((v) => Number.isInteger(v) && v >= 0 && v <= 99)) return "신용도 범위는 0~99 정수예요.";
  if (o.creditMin > o.creditMax) return "신용도 최소가 최대보다 클 수 없어요.";
  if (o.skills.length > MAX_OCCUPATION_SKILLS) return `직업 기능은 ${MAX_OCCUPATION_SKILLS}개까지예요.`;
  if (new Set(o.skills).size !== o.skills.length) return "같은 기능이 두 번 들어 있어요.";
  const known = new Set(creationSkills({ STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 }).map((s) => s.name));
  for (const s of o.skills) {
    if (!known.has(s) || (FIXED_SKILLS as readonly string[]).includes(s) || s === CREDIT_RATING) return `'${s}'은(는) 직업 기능으로 넣을 수 없어요.`;
  }
  return null;
}

// ── 기능 포인트 ───────────────────────────────────────────

export const OCCUPATION_POINT_FORMULAS = [
  { id: "edu4", label: "EDU×4", other: null },
  { id: "edu2str2", label: "EDU×2 + STR×2", other: "STR" },
  { id: "edu2dex2", label: "EDU×2 + DEX×2", other: "DEX" },
  { id: "edu2app2", label: "EDU×2 + APP×2", other: "APP" },
  { id: "edu2pow2", label: "EDU×2 + POW×2", other: "POW" },
] as const;
export type OccupationFormulaId = (typeof OCCUPATION_POINT_FORMULAS)[number]["id"];

/** 생성 때 기능 하나를 올릴 수 있는 상한 */
export const SKILL_CREATION_CAP = 75;
/** 생성 포인트를 쓸 수 없는 기능 */
export const FIXED_SKILLS = ["크툴루 신화", "모국어"] as const;

export function occupationPoints(c: Characteristics, id: OccupationFormulaId): number {
  const f = OCCUPATION_POINT_FORMULAS.find((x) => x.id === id)!;
  return f.other ? c.EDU * 2 + c[f.other] * 2 : c.EDU * 4;
}

export const personalPoints = (c: Characteristics): number => c.INT * 2;

export type SkillAllocation = Record<string, { occ: number; personal: number }>;

/** 포인트를 쓰기 전 기능 이름과 초기값(기본 기능 + 회피 + 모국어) */
export const creationSkills = (c: Characteristics) => defaultSkillValues({ characteristics: c });

export interface AllocationCheck {
  occPool: number;
  personalPool: number;
  occUsed: number;
  personalUsed: number;
  errors: string[];
}

export function checkAllocation(c: Characteristics, id: OccupationFormulaId, alloc: SkillAllocation, occupation?: Occupation): AllocationCheck {
  const base = new Map(creationSkills(c).map((s) => [s.name, s.value]));
  const errors: string[] = [];
  let occUsed = 0;
  let personalUsed = 0;
  for (const [name, a] of Object.entries(alloc)) {
    if (!base.has(name)) {
      errors.push(`'${name}'은(는) 알 수 없는 기능이에요.`);
      continue;
    }
    if (!Number.isInteger(a.occ) || !Number.isInteger(a.personal) || a.occ < 0 || a.personal < 0) {
      errors.push(`${name}: 포인트는 0 이상의 정수여야 해요.`);
      continue;
    }
    if ((a.occ > 0 || a.personal > 0) && (FIXED_SKILLS as readonly string[]).includes(name)) errors.push(`${name}에는 포인트를 쓸 수 없어요.`);
    occUsed += a.occ;
    personalUsed += a.personal;
    // 신용도는 직업의 신용도 범위가 상한이라 75 제한에서 뺀다(아래 직업 검사).
    if (name !== CREDIT_RATING && base.get(name)! + a.occ + a.personal > SKILL_CREATION_CAP && a.occ + a.personal > 0) errors.push(`${name}: 생성 때는 ${SKILL_CREATION_CAP}까지만 올릴 수 있어요.`);
  }
  if (occupation) {
    const allowed = new Set<string>([...occupation.skills, CREDIT_RATING]);
    for (const [name, a] of Object.entries(alloc)) {
      if (a.occ > 0 && !allowed.has(name)) errors.push(`${name}: 직업 포인트는 '${occupation.name}'의 직업 기능에만 쓸 수 있어요.`);
    }
    const credit = (base.get(CREDIT_RATING) ?? 0) + (alloc[CREDIT_RATING]?.occ ?? 0) + (alloc[CREDIT_RATING]?.personal ?? 0);
    if (credit < occupation.creditMin || credit > occupation.creditMax) errors.push(`${CREDIT_RATING}은(는) '${occupation.name}'에서 ${occupation.creditMin}~${occupation.creditMax} 사이여야 해요. (지금 ${credit})`);
  }
  const occPool = occupationPoints(c, id);
  const personalPool = personalPoints(c);
  if (occUsed > occPool) errors.push(`직업 포인트를 ${occUsed - occPool}점 넘게 썼어요.`);
  if (personalUsed > personalPool) errors.push(`관심 포인트를 ${personalUsed - personalPool}점 넘게 썼어요.`);
  return { occPool, personalPool, occUsed, personalUsed, errors };
}

export interface CreationDraft {
  name: string;
  age: number;
  occupation: string;
  characteristics: Characteristics;
  luck: number;
  alloc: SkillAllocation;
  backstory?: string;
  possessions?: string;
}

/** 마법사에서 고른 값으로 보관함에 저장할 캐릭터를 만든다. */
export function buildCharacterInput(d: CreationDraft): CharacterInput {
  return {
    name: d.name.trim(),
    age: d.age,
    occupation: d.occupation.trim(),
    characteristics: d.characteristics,
    luck: d.luck,
    skills: creationSkills(d.characteristics).map((s) => {
      const a = d.alloc[s.name];
      return { name: s.name, value: Math.min(100, s.value + (a ? a.occ + a.personal : 0)), grown: false };
    }),
    notes: "",
    backstory: d.backstory ?? "",
    possessions: d.possessions ?? "",
    weapons: [],
  };
}
