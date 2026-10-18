import { CHARACTERISTIC_KEYS, DEFAULT_SKILLS, type Character } from "@coc-vtt/shared";

/** 대항 판정에서 고를 수 있는 이름: 시트의 기능 → 특성치 → 행운 순(기능은 가나다순). */
export function skillOptions(c: Pick<Character, "skills"> | undefined): string[] {
  if (!c) return [];
  return [...Object.keys(c.skills).sort((a, b) => a.localeCompare(b, "ko")), ...CHARACTERISTIC_KEYS, "행운"];
}

/** 상대 시트를 못 보는 PL에게 보여 줄 후보: 기본 기능 이름 + 특성치 + 행운 */
export function commonSkillNames(): string[] {
  return [...DEFAULT_SKILLS.map((s) => s.name), "회피", ...CHARACTERISTIC_KEYS, "행운"];
}
