"use client";
import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";

/** 방향키·Home·End로 옮길 다음 칸. 옮기지 않는 키면 null. loop면 끝에서 처음으로 돈다. */
export function nextRovingIndex(count: number, cur: number, key: string, loop = false): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const at = cur < 0 ? 0 : cur;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return at >= last ? (loop ? 0 : last) : at + 1;
    case "ArrowLeft":
    case "ArrowUp":
      return at <= 0 ? (loop ? last : 0) : at - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

const enabled = (root: HTMLElement, selector: string) => [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");

/** 줄 안의 칸 가운데 하나만 Tab으로 닿게(tabindex 0) 하고 나머지는 -1로 둔다. 고른 탭(aria-selected)이나 마지막으로 초점을 받은 칸이 그 하나다. */
export function syncRoving(root: HTMLElement, selector: string, preferred?: HTMLElement | null) {
  const items = enabled(root, selector);
  if (items.length === 0) return;
  const active = (preferred && items.includes(preferred) ? preferred : null) ?? items.find((el) => el.getAttribute("aria-selected") === "true") ?? items[0]!;
  for (const el of root.querySelectorAll<HTMLElement>(selector)) el.tabIndex = el === active ? 0 : -1;
}

/**
 * 도구 줄 하나를 Tab 한 번으로 지나가게 하고, 안에서는 방향키로 옮기게 한다(roving tabindex).
 * 연출 칸처럼 같은 모양의 버튼이 줄지어 있을 때 키보드 사용자가 Tab을 열 번씩 누르지 않게 한다.
 */
export function useRoving<T extends HTMLElement>(selector: string, opts: { loop?: boolean } = {}) {
  const ref = useRef<T>(null);
  const last = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (ref.current) syncRoving(ref.current, selector, last.current);
  });
  return {
    ref,
    onFocus: (e: FocusEvent<T>) => {
      const hit = (e.target as HTMLElement).closest<HTMLElement>(selector);
      if (!hit || !ref.current) return;
      last.current = hit;
      syncRoving(ref.current, selector, hit);
    },
    onKeyDown: (e: KeyboardEvent<T>) => {
      if (!ref.current || e.altKey || e.ctrlKey || e.metaKey) return;
      const items = enabled(ref.current, selector);
      const cur = items.findIndex((el) => el === document.activeElement);
      if (cur < 0) return;
      const to = nextRovingIndex(items.length, cur, e.key, opts.loop);
      if (to === null) return;
      e.preventDefault();
      items[to]!.focus();
    },
  };
}
