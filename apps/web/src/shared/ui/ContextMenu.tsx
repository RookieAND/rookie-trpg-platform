"use client";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

export interface ContextItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

interface Open {
  x: number;
  y: number;
  items: ContextItem[];
}

/** 우클릭(또는 길게 누르기, Shift+F10)으로 여는 작은 메뉴. 열 항목이 없으면 기본 메뉴를 그대로 둔다. */
export function useContextMenu() {
  const [open, setOpen] = useState<Open | null>(null);
  const onContextMenu = (items: ContextItem[]) => (e: MouseEvent) => {
    if (items.length === 0) return;
    e.preventDefault();
    setOpen({ x: e.clientX, y: e.clientY, items });
  };
  const menu = open ? <ContextMenuView at={open} onClose={() => setOpen(null)} /> : null;
  return { onContextMenu, menu };
}

function ContextMenuView({ at, onClose }: { at: Open; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: at.x, y: at.y });

  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ x: Math.max(4, Math.min(at.x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(at.y, window.innerHeight - r.height - 4)) });
      el.querySelector<HTMLElement>("button")?.focus();
    }
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("contextmenu", away, true);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("contextmenu", away, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", onClose, true);
    };
  }, [at, onClose]);

  return createPortal(
    <div ref={ref} className="ctxmenu" role="menu" data-testid="context-menu" style={{ left: pos.x, top: pos.y }}>
      {at.items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={`ctxmenu-item${it.danger ? " danger" : ""}`}
          onClick={() => {
            onClose();
            it.onSelect();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
