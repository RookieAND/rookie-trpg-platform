import { deriveStats, type Characteristics } from "./dice";
import { own } from "./safe-key";

/** CoC 7판 캐릭터 시트. 룸 안에서 쓰는 복사본이고, 원본은 보관함에 있다. */

export const CHARACTERISTIC_KEYS = ["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU"] as const;
export type CharacteristicKey = (typeof CHARACTERISTIC_KEYS)[number];

export interface SkillEntry {
  value: number;
  /** 성장 표시(체크). 세션이 끝나면 성장 굴림 대상이 된다. */
  grown: boolean;
}

export const MAX_WEAPONS = 12;

/** 무기 한 줄. skill은 공격 때 굴리는 기능 이름, damage는 1d6+2나 1d8+db(피해 보너스) 같은 식이다. */
export interface Weapon {
  name: string;
  skill: string;
  damage: string;
}

export const CONDITIONS = ["majorWound", "unconscious", "dying", "dead"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABEL_KO: Record<Condition, string> = {
  majorWound: "중상",
  unconscious: "기절",
  dying: "빈사",
  dead: "사망",
};

export const MADNESS_KINDS = ["none", "temporary", "indefinite", "permanent"] as const;
export type Madness = (typeof MADNESS_KINDS)[number];
export const MADNESS_LABEL_KO: Record<Exclude<Madness, "none">, string> = {
  temporary: "일시적 광기",
  indefinite: "장기 광기",
  permanent: "영구 광기",
};

/** 하루 단위 SAN 손실 기록. 하루 손실이 하루 시작 SAN의 1/5 이상이면 장기 광기가 된다. */
export interface SanDay {
  start: number;
  lost: number;
}

export interface Character {
  id: string;
  /** 보관함에서 불러왔다면 원본 id */
  vaultId?: string;
  /** 시트의 주인. NPC는 GM이 만든다. */
  ownerId: string;
  name: string;
  age: number;
  occupation: string;
  characteristics: Record<CharacteristicKey, number>;
  luck: number;
  hp: number;
  mp: number;
  san: number;
  skills: Record<string, SkillEntry>;
  notes: string;
  /** 인물 배경. 이전 데이터에는 없을 수 있다. */
  backstory?: string;
  possessions?: string;
  weapons?: Weapon[];
  /** 중상·기절·빈사·사망 표시. 룸 안에서만 쓰고 보관함에는 저장하지 않는다. 서버가 HP 변화로 정하고, 직접 바꾸는 것은 GM뿐이다(wounds.ts). */
  conditions?: Condition[];
  /** 빈사 상태로 넘긴 라운드 수. 전투 라운드가 오를 때 서버가 올리고, 빈사가 풀리면 지운다. */
  dyingRounds?: number;
  /** 광기 상태. GM이 해제한다. 없으면 정상. */
  madness?: Madness;
  sanDay?: SanDay;
  /** 바뀔 때마다 1씩 오른다. */
  rev: number;
}

export const STAT_PATHS = ["hp", "mp", "san", "luck"] as const;
export type StatPath = (typeof STAT_PATHS)[number];

export const MAX_SKILLS = 150;
export const SAN_CAP = 99;
export const LUCK_CAP = 99;
export const SKILL_CAP = 100;

export interface CharacterLimits {
  hp: number;
  mp: number;
  san: number;
  luck: number;
}

/** 특성치에서 나오는 값(최대 HP·MP, 이동력, 피해 보너스, 체격). 저장하지 않고 늘 다시 계산한다. */
export function deriveCharacter(c: Pick<Character, "characteristics" | "age">) {
  const stats = deriveStats(c.characteristics as Characteristics, c.age);
  const limits: CharacterLimits = { hp: stats.hp, mp: stats.mp, san: SAN_CAP, luck: LUCK_CAP };
  return { ...stats, limits };
}

/** 이름으로 굴림 목표값을 찾는다. 기능(스킬)이 먼저고, 없으면 특성치(STR 등)를 본다. */
export function targetValue(c: Character, name: string): number | null {
  const skill = own(c.skills, name);
  if (skill) return skill.value;
  const key = name.toUpperCase() as CharacteristicKey;
  if ((CHARACTERISTIC_KEYS as readonly string[]).includes(key)) return c.characteristics[key];
  if (name === "행운" || name.toUpperCase() === "LUCK") return c.luck;
  return null;
}

// ── 캐릭터 만들기 보조 ────────────────────────────────────

/** 7판 기본 기능과 초기값. 회피(DEX/2)와 모국어(EDU)는 특성치에 따라 달라서 따로 계산한다. */
export const DEFAULT_SKILLS: ReadonlyArray<{ name: string; base: number }> = [
  { name: "감정", base: 5 },
  { name: "고고학", base: 1 },
  { name: "관찰력", base: 25 },
  { name: "기계 수리", base: 10 },
  { name: "도약", base: 20 },
  { name: "도서관 이용", base: 20 },
  { name: "말재주", base: 5 },
  { name: "매혹", base: 15 },
  { name: "맨손 격투", base: 25 },
  { name: "몰래 행동", base: 20 },
  { name: "법률", base: 5 },
  { name: "변장", base: 5 },
  { name: "사격(권총)", base: 20 },
  { name: "사격(소총/산탄총)", base: 25 },
  { name: "생존술", base: 10 },
  { name: "설득", base: 10 },
  { name: "손놀림", base: 10 },
  { name: "수영", base: 20 },
  { name: "승마", base: 5 },
  { name: "심리분석", base: 1 },
  { name: "심리학", base: 10 },
  { name: "역사", base: 5 },
  { name: "오르기", base: 20 },
  { name: "오컬트", base: 5 },
  { name: "위협", base: 15 },
  { name: "응급처치", base: 30 },
  { name: "의학", base: 1 },
  { name: "인류학", base: 1 },
  { name: "자동차 운전", base: 20 },
  { name: "자물쇠 따기", base: 1 },
  { name: "자연", base: 10 },
  { name: "전기 수리", base: 10 },
  { name: "청각", base: 20 },
  { name: "추적", base: 10 },
  { name: "투척", base: 20 },
  { name: "항법", base: 10 },
  { name: "회계", base: 5 },
  // 이름을 고쳐 쓰는 기능(분야·언어·무기를 괄호로 적어 바꾼다). 값은 룰북의 초기값이다.
  { name: "외국어", base: 1 },
  { name: "예술/공예", base: 5 },
  { name: "과학", base: 1 },
  { name: "조종", base: 1 },
  { name: "중장비 조작", base: 1 },
  { name: "사격(기관총 등)", base: 10 },
  { name: "신용도", base: 0 },
  { name: "크툴루 신화", base: 0 },
];

/** 기본 기능 목록에 회피와 모국어를 더한 초기 기능 값 */
export function defaultSkillValues(c: Pick<Character, "characteristics">): Array<{ name: string; value: number }> {
  return [
    ...DEFAULT_SKILLS.map((s) => ({ name: s.name, value: s.base })),
    { name: "회피", value: Math.floor(c.characteristics.DEX / 2) },
    { name: "모국어", value: c.characteristics.EDU },
  ];
}

/** 7판 특성치 굴림: STR·CON·DEX·APP·POW는 3d6×5, SIZ·INT·EDU는 (2d6+6)×5, 행운은 3d6×5. */
export function rollCharacteristics(rng: () => number): { characteristics: Record<CharacteristicKey, number>; luck: number } {
  const d6 = () => Math.floor(rng() * 6) + 1;
  const three = () => (d6() + d6() + d6()) * 5;
  const two = () => (d6() + d6() + 6) * 5;
  return {
    characteristics: { STR: three(), CON: three(), SIZ: two(), DEX: three(), APP: three(), INT: two(), POW: three(), EDU: two() },
    luck: three(),
  };
}

// ── 기능 목록 보조 ────────────────────────────────────────

/** 특성치에 따른 기능 초기값 표(이름 → 값). 회피와 모국어는 DEX·EDU로 계산한다. */
export function skillBaseValues(c: Pick<Character, "characteristics">): Map<string, number> {
  return new Map(defaultSkillValues(c).map((s) => [s.name, s.value]));
}

/** 초기값에서 손댄 기능인가(값이 다르거나, 목록에 없는 기능이거나, 성장 표시가 있다). */
export function isSkillEdited(base: ReadonlyMap<string, number>, name: string, entry: { value: number; grown?: boolean }): boolean {
  return entry.grown === true || !base.has(name) || base.get(name) !== entry.value;
}
