import type { Handout } from "@coc-vtt/shared";

/** 펼쳐 보이기를 누를 수 없는 이유 한 줄. 누를 수 있으면 null. */
export function showBlockReason(h: Pick<Handout, "visibleTo" | "kpOnly">, canShow: boolean): string | null {
  if (h.kpOnly) return null;
  if (!canShow) return "일시정지 중에는 펼쳐 보일 수 없어요. 이어하기를 누른 뒤에 해 주세요.";
  if (h.visibleTo === "gm") return "초안이라 GM만 볼 수 있어요. ‘공개하기’를 누르면 모두에게 공개하고 바로 펼쳐 보여요.";
  return null;
}
