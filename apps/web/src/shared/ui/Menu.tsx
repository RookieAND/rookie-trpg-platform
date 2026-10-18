"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 모아 둔 버튼을 하나의 메뉴로 접는다. 바깥을 누르거나 Esc를 누르면 닫힌다.
 * children에 함수를 주면 항목 안에서 메뉴를 닫을 수 있다(예: 이름 변경을 누른 뒤).
 * 메뉴 안의 항목이 대화상자를 열면 목록은 숨기고 대화상자만 남긴다(CSS의 :has).
 */
export function Menu({ label, title, testId, align = "right", children }: { label: ReactNode; title?: string; testId?: string; align?: "left" | "right"; children: ReactNode | ((close: () => void) => ReactNode) }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); // 같은 키를 다른 단축키(선택 해제 등)가 또 쓰지 않게
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    // 메뉴 항목이 연 대화상자가 닫히면 메뉴도 함께 닫는다(목록만 다시 덩그러니 남지 않게).
    let hadDialog = false;
    const watcher = root.current
      ? new MutationObserver(() => {
          const has = Boolean(root.current?.querySelector('[role="dialog"]'));
          if (has) hadDialog = true;
          else if (hadDialog) setOpen(false);
        })
      : null;
    if (root.current) watcher?.observe(root.current, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      watcher?.disconnect();
    };
  }, [open]);

  return (
    <span className="menu" ref={root}>
      <button className="btn ghost" aria-haspopup="menu" aria-expanded={open} title={title} data-testid={testId} onClick={() => setOpen((o) => !o)}>
        {label} <span aria-hidden style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div className={`menu-panel ${align === "left" ? "left" : ""}`} role="menu">
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </span>
  );
}

/** 메뉴 안의 묶음 제목 */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>;
}
