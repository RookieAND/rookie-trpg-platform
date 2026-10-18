/** Ctrl/⌘+Z 로 보고, 입력칸에 포커스가 없을 때만 되돌리기로 쓴다(입력칸에서는 글자 되돌리기를 그대로 둔다). */
export function isUndoKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "target">): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false;
  if (e.key.toLowerCase() !== "z") return false;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = t?.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return false;
  return true;
}

/** 되돌릴 수 있는 삭제 동작을 한 뒤 띄울 안내. 해당하지 않으면 null. */
export function undoHint(type: string): string | null {
  switch (type) {
    case "object.remove":
      return "삭제했어요 · 되돌리려면 Ctrl+Z";
    case "fog.clear":
      return "밝힌 영역을 모두 지웠어요 · 되돌리려면 Ctrl+Z";
    case "fog.forget":
      return "탐험 기록을 지웠어요 · 되돌리려면 Ctrl+Z";
    default:
      return null;
  }
}
