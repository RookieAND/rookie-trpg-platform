"use client";
import type { ReactNode } from "react";
import { onTabListKeyDown } from "@/shared/ui";

export interface DockTabDef<T extends string> {
  id: T;
  label: string;
}

/**
 * 데스크톱 GM의 보드 아래 도구 줄. 놓기·안개·연출을 한 줄에 탭으로 묶어 한 번에 하나만 보여 준다.
 * 묶음은 모두 그려 두고 보이지 않는 것만 숨긴다(연출 칸의 숫자 키가 다른 탭에서도 살아 있게).
 */
export function ToolDock<T extends string>({ tab, tabs, onTab, sections }: { tab: T; tabs: DockTabDef<T>[]; onTab: (t: T) => void; sections: Record<T, ReactNode> }) {
  return (
    <div className="tooldock" data-testid="tool-dock">
      <div className="tooldock-tabs" role="tablist" aria-label="도구 고르기" onKeyDown={onTabListKeyDown}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`dock-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`dock-sec-${t.id}`} data-testid={`dock-tab-${t.id}`} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="tooldock-body">
        {tabs.map((t) => (
          <div key={t.id} className="tooldock-sec" id={`dock-sec-${t.id}`} role="tabpanel" aria-labelledby={`dock-tab-${t.id}`} hidden={tab !== t.id}>
            {sections[t.id]}
          </div>
        ))}
      </div>
    </div>
  );
}
