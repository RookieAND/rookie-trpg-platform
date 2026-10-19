"use client";
import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { onTabListKeyDown } from "./tab-keys";
import { useRoving } from "./roving";
import { scrollTarget, tabEdges } from "./tab-scroll";

/**
 * 탭이 줄에 다 안 들어가면 가로로 밀 수 있는 탭 줄. 잘린 쪽은 흐려지고 ‹ › 버튼이 보이며,
 * 키보드로 탭을 옮기거나 선택이 바뀌면 그 탭이 보이는 곳까지 줄이 따라가요(탭이 숨은 채 남지 않아요).
 */
export function ScrollTabs({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  // 탭 줄은 Tab으로 한 번만 닿고(고른 탭), 안에서는 방향키로 옮긴다
  const roving = useRoving<HTMLDivElement>('[role="tab"]');
  const list = roving.ref;
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = list.current;
    if (el) setEdges(tabEdges(el.scrollLeft, el.clientWidth, el.scrollWidth));
  }, []);
  const reveal = useCallback((tab: HTMLElement | null) => {
    const el = list.current;
    if (!el || !tab) return;
    const next = scrollTarget(el.scrollLeft, el.clientWidth, tab.offsetLeft, tab.offsetWidth);
    if (next !== el.scrollLeft) el.scrollLeft = next;
  }, []);

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    // 탭이 늘거나 줄어도 다시 잰다
    const mo = new MutationObserver(() => {
      measure();
      reveal(el.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'));
    });
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
    return () => {
      ro?.disconnect();
      mo.disconnect();
    };
  }, [measure, reveal]);

  const nudge = (dir: -1 | 1) => list.current?.scrollBy({ left: dir * Math.max(80, list.current.clientWidth * 0.6), behavior: "smooth" });
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    onTabListKeyDown(e);
    // 방향키로 옮긴 탭이 보이게(포커스가 옮겨진 뒤)
    queueMicrotask(() => reveal(document.activeElement as HTMLElement | null));
  };

  return (
    <div className={`tabs-wrap ${className}`} data-left={edges.left || undefined} data-right={edges.right || undefined}>
      {edges.left && (
        <button type="button" className="tabs-more left" tabIndex={-1} aria-hidden data-testid="tabs-more-left" title="앞쪽 탭 보기" onClick={() => nudge(-1)}>‹</button>
      )}
      <div className="tabs" role="tablist" aria-label={label} ref={list} onScroll={measure} onKeyDown={onKey} onFocus={roving.onFocus} onFocusCapture={(e) => reveal(e.target as HTMLElement)}>
        {children}
      </div>
      {edges.right && (
        <button type="button" className="tabs-more right" tabIndex={-1} aria-hidden data-testid="tabs-more-right" title="뒤쪽 탭 보기" onClick={() => nudge(1)}>›</button>
      )}
    </div>
  );
}
