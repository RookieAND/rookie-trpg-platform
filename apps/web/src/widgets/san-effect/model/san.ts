import type { RollOutcome } from "@coc-vtt/shared";

export type SanEffectKind = "heavy" | "madness";

/** 한 번에 이만큼 이상 잃으면 큰 손실로 본다(규칙의 INT 판정 기준과 같다). */
export const HEAVY_LOSS = 5;

/** SAN 체크 결과에서 보여 줄 효과를 고른다. 큰 손실이나 새 광기만 해당하고, 나머지는 null. */
export function sanEffectKind(o: RollOutcome): SanEffectKind | null {
  if (o.kind !== "san") return null;
  if (o.madness) return "madness";
  return o.loss >= HEAVY_LOSS ? "heavy" : null;
}

export const SAN_EFFECT_TEXT: Record<SanEffectKind, string> = {
  heavy: "정신이 크게 흔들려요",
  madness: "광기가 스며들어요",
};
