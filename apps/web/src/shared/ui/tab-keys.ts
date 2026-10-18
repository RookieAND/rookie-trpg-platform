import type { KeyboardEvent } from "react";

/** 탭 목록의 화살표·Home·End 키 처리. 다음 탭에 포커스를 주고 눌러서 바꾼다. */
export function onTabListKeyDown(e: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
  if (tabs.length === 0) return;
  const cur = tabs.findIndex((t) => t === document.activeElement || t.contains(document.activeElement));
  let next = cur;
  if (e.key === "ArrowRight") next = (cur + 1) % tabs.length;
  else if (e.key === "ArrowLeft") next = (cur - 1 + tabs.length) % tabs.length;
  else if (e.key === "Home") next = 0;
  else next = tabs.length - 1;
  e.preventDefault();
  tabs[next]!.focus();
  tabs[next]!.click();
}
