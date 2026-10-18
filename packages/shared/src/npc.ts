import { deriveStats, type Characteristics } from "./dice";
import type { CharacterData } from "./protocol";
import { defaultSkillValues } from "./sheet";

/**
 * "빠른 NPC": 이름과 몇 가지 숫자만으로 NPC 시트를 만든다.
 * HP는 CON+SIZ에서 나오므로 입력한 HP가 나오도록 CON을 맞춘다. 피해 보너스는 STR+SIZ에서 저절로 정해진다.
 * 방어구는 시트에 칸이 없어서 메모에 적는다(피해를 적용할 때 그 값을 넣는다).
 */
export interface QuickNpc {
  name: string;
  hp: number;
  str: number;
  siz: number;
  dex: number;
  /** 무기 기능의 값(맨손 격투·사격 등) */
  fight: number;
  /** 회피. 비우면 DEX의 절반 */
  dodge?: number;
  weaponName?: string;
  /** 무기 기능 이름. 기본은 "맨손 격투" */
  weaponSkill?: string;
  /** 피해 식. 기본은 1d3+db */
  weaponDamage?: string;
  armor?: number;
  /** 직업 칸에 적을 말 */
  label?: string;
}

export const QUICK_NPC_HP_MAX = 19;

export interface NpcPreset {
  id: string;
  label: string;
  values: Omit<QuickNpc, "name">;
}

export const NPC_PRESETS: readonly NpcPreset[] = [
  { id: "citizen", label: "일반인", values: { hp: 10, str: 50, siz: 60, dex: 50, fight: 30, weaponName: "주먹", weaponDamage: "1d3+db", armor: 0, label: "일반인" } },
  { id: "thug", label: "불량배", values: { hp: 12, str: 70, siz: 65, dex: 55, fight: 60, weaponName: "곤봉", weaponDamage: "1d6+db", armor: 0, label: "불량배" } },
  { id: "police", label: "경찰관", values: { hp: 12, str: 60, siz: 65, dex: 55, fight: 55, weaponName: "경찰봉", weaponDamage: "1d6+db", armor: 0, label: "경찰관" } },
  { id: "cultist", label: "광신도", values: { hp: 10, str: 55, siz: 55, dex: 50, fight: 50, weaponName: "의식용 단검", weaponDamage: "1d4+db", armor: 0, label: "광신도" } },
  { id: "beast", label: "사나운 짐승", values: { hp: 11, str: 60, siz: 50, dex: 70, fight: 45, dodge: 45, weaponName: "물어뜯기", weaponDamage: "1d6", armor: 1, label: "짐승" } },
  { id: "monster", label: "괴물", values: { hp: 18, str: 90, siz: 90, dex: 50, fight: 60, weaponName: "촉수", weaponDamage: "1d8+db", armor: 2, label: "괴물" } },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

/** 입력한 값으로 NPC 시트(character.add 데이터)를 만든다. 값은 허용 범위로 맞춘다. */
export function buildQuickNpc(q: QuickNpc): CharacterData {
  const hp = clamp(q.hp, 1, QUICK_NPC_HP_MAX);
  let siz = clamp(q.siz, 1, 99);
  // (CON+SIZ)/10을 내림한 값이 hp가 되도록 CON을 맞춘다. 범위를 벗어나면 SIZ도 함께 맞춘다.
  const total = hp * 10 + 5;
  let con = total - siz;
  if (con < 1) (con = 1), (siz = total - 1);
  if (con > 99) (con = 99), (siz = total - 99);
  const characteristics = { STR: clamp(q.str, 1, 99), CON: con, SIZ: siz, DEX: clamp(q.dex, 1, 99), APP: 50, INT: 50, POW: 50, EDU: 50 } satisfies Characteristics;

  const skills = new Map(defaultSkillValues({ characteristics }).map((s) => [s.name, s.value]));
  const weaponSkill = (q.weaponSkill ?? "맨손 격투").trim() || "맨손 격투";
  const fight = clamp(q.fight, 0, 100);
  skills.set(weaponSkill, fight);
  if (q.dodge !== undefined) skills.set("회피", clamp(q.dodge, 0, 100));

  const armor = clamp(q.armor ?? 0, 0, 20);
  const weaponName = q.weaponName?.trim();
  const stats = deriveStats(characteristics, 30);
  return {
    name: q.name.trim().slice(0, 40),
    age: 30,
    occupation: (q.label ?? "").slice(0, 40),
    characteristics,
    hp: Math.min(hp, stats.hp),
    skills: [...skills].map(([name, value]) => ({ name, value, grown: false })),
    notes: armor > 0 ? `방어구 ${armor}` : "",
    backstory: "",
    possessions: "",
    weapons: weaponName ? [{ name: weaponName.slice(0, 30), skill: weaponSkill.slice(0, 30), damage: (q.weaponDamage ?? "1d3+db").trim() || "1d3+db" }] : [],
  };
}

/** 폼에 미리 보여 줄 파생 값(피해 보너스·체격) */
export function quickNpcPreview(q: Pick<QuickNpc, "str" | "siz" | "hp">): { damageBonus: string; build: number } {
  const hp = clamp(q.hp, 1, QUICK_NPC_HP_MAX);
  const siz = clamp(q.siz, 1, 99);
  const total = hp * 10 + 5;
  const adjSiz = total - siz < 1 ? total - 1 : total - siz > 99 ? total - 99 : siz;
  const s = deriveStats({ STR: clamp(q.str, 1, 99), CON: 50, SIZ: adjSiz, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 }, 30);
  return { damageBonus: s.damageBonus, build: s.build };
}
