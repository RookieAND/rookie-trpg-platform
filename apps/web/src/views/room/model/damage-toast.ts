import { josa, type DamageApplied } from "@coc-vtt/shared";

/** 피해를 적용한 결과를 토스트 한 줄로. 시트 주인과 GM만 받는다. */
export function damageToastText(r: Pick<DamageApplied, "name" | "amount" | "armor" | "dealt" | "hpBefore" | "hp" | "kind" | "massive" | "conRoll">): string {
  const head = r.dealt === 0 ? `${josa(r.name, "은/는")} 피해를 받지 않았어요` : `${r.name}에게 피해 ${r.dealt}만큼 적용했어요${r.armor > 0 ? ` (방어구 ${r.armor})` : ""}`;
  const hp = r.dealt === 0 ? "" : ` · HP ${r.hpBefore} → ${r.hp}`;
  const tail =
    r.kind === "dead"
      ? " · 사망했어요"
      : r.kind === "dying"
        ? " · 빈사 상태예요"
        : r.kind === "unconscious"
          ? " · 기절했어요"
          : r.kind === "major"
            ? " · 중상이에요. 건강 판정(CON)을 해요"
            : "";
  return `${head}${hp}${tail}`;
}
