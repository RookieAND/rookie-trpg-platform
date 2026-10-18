"use client";
import type { ReactNode } from "react";

export interface DockItem {
  id: string;
  label: string;
  onClick: () => void;
  /** 알림 숫자(0이면 안 보인다) */
  badge?: number;
  badgeLabel?: string;
  primary?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  testId?: string;
  title?: string;
}

/** 휴대폰 맨 아래 줄. 엄지로 닿는 큰 버튼들(굴림·시트·대화 같은 패널 서랍 열기 등). */
export function PanelDock({ items, label, children, className = "" }: { items: DockItem[]; label: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`panel-dock ${className}`} role="toolbar" aria-label={label} data-testid="panel-dock">
      {items.map((it) => (
        <button key={it.id} type="button" className={`btn${it.primary ? " primary" : ""}`} data-testid={it.testId} aria-pressed={it.pressed} disabled={it.disabled} title={it.title} onClick={it.onClick}>
          {it.label}
          {!!it.badge && <span className="tab-dot" aria-label={it.badgeLabel ?? `${it.badge}개`}>{it.badge > 99 ? "99+" : it.badge}</span>}
        </button>
      ))}
      {children}
    </div>
  );
}
