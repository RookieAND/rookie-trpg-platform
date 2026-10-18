import type { Character } from "@coc-vtt/shared";

/** 중상이 되는 한 번의 피해: 최대 HP의 절반 이상(홀수면 올림). */
export const woundThreshold = (maxHp: number): number => Math.ceil(maxHp / 2);

export interface WoundHint {
  text: string;
  danger: boolean;
}

/** 시트에 보여 줄 상태 안내 한 줄. 상태가 없으면 null. */
export function woundHint(c: Pick<Character, "conditions" | "dyingRounds">, maxHp: number): WoundHint | null {
  const conds = new Set(c.conditions ?? []);
  if (conds.has("dead")) return { text: "사망했어요. GM이 사망 표시를 풀기 전에는 HP를 바꿀 수 없어요.", danger: true };
  if (conds.has("dying")) {
    const rounds = c.dyingRounds ?? 0;
    return { text: `빈사 상태예요${rounds > 0 ? ` (${rounds}라운드째)` : ""}. 응급처치가 없으면 매 라운드 건강 판정(CON)을 하고, 실패하면 사망해요.`, danger: true };
  }
  if (conds.has("unconscious")) return { text: "의식을 잃었어요. HP가 1 이상이 되거나 GM이 풀어 줄 때까지 행동할 수 없어요.", danger: false };
  if (conds.has("majorWound")) return { text: `중상이에요. 건강 판정(CON)에 실패하면 의식을 잃어요. HP가 ${woundThreshold(maxHp)} 이상이 되면 중상이 풀려요.`, danger: false };
  return null;
}
