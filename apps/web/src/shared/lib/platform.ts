/** 이 기기의 수정 키 이름: 맥·아이폰은 ⌘, 그 밖은 Ctrl. 화면에서만 부른다(서버에서는 Ctrl). */
export const modKey = (): "⌘" | "Ctrl" =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";

/** 수정 키와 다른 키를 붙인 표시. 맥은 ⌘K, 그 밖은 Ctrl+K */
export const withMod = (key: string): string => (modKey() === "⌘" ? `⌘${key}` : `Ctrl+${key}`);
