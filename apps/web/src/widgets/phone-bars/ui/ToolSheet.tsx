"use client";
import type { ReactNode } from "react";
import { onTabListKeyDown } from "@/shared/ui";

export interface SheetTabDef<T extends string> {
  id: T;
  label: string;
  /** 탭 옆의 작은 표시(예: 선택한 이름) */
  hint?: string;
}

/**
 * 휴대폰 GM의 도구 시트. 접으면 손잡이 줄 하나와 빠른 도구 한 줄만 남고(지도를 가리지 않는다),
 * 펴면 빠른 줄 위로 탭이 있는 묶음이 지도 위에 펼쳐진다. 빠른 줄은 펴도 가려지지 않는다.
 * 묶음은 모두 그려 두고 보이지 않는 것만 숨긴다(안에서 키 입력을 받는 연출 칸이 계속 살아 있게).
 */
export function ToolSheet<T extends string>({
  open,
  tab,
  tabs,
  onToggle,
  onTab,
  quick,
  sections,
}: {
  open: boolean;
  tab: T;
  tabs: SheetTabDef<T>[];
  onToggle: () => void;
  onTab: (t: T) => void;
  /** 접어도 보이는 한 줄 */
  quick: ReactNode;
  sections: Record<T, ReactNode>;
}) {
  return (
    <div className="toolsheet" data-testid="tool-sheet" data-open={open}>
      <div className="sheet-body" id="tool-sheet-body" role="region" aria-label="도구 묶음" hidden={!open} data-testid="tool-sheet-body">
        <div className="sheet-tabs" role="tablist" aria-label="도구 묶음 고르기" onKeyDown={onTabListKeyDown}>
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`sheet-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`sheet-sec-${t.id}`} data-testid={`sheet-tab-${t.id}`} onClick={() => onTab(t.id)}>
              {t.label}
              {t.hint && <span className="sheet-tab-hint">{t.hint}</span>}
            </button>
          ))}
        </div>
        {tabs.map((t) => (
          <div key={t.id} className="sheet-sec" id={`sheet-sec-${t.id}`} role="tabpanel" aria-labelledby={`sheet-tab-${t.id}`} hidden={tab !== t.id}>
            {sections[t.id]}
          </div>
        ))}
      </div>
      <button type="button" className="sheet-handle" data-testid="sheet-handle" aria-expanded={open} aria-controls="tool-sheet-body" onClick={onToggle}>
        <span className="grip" aria-hidden />
        <span>{open ? "도구 접기" : "도구 더보기"}</span>
      </button>
      <div className="sheet-quick" role="toolbar" aria-label="빠른 도구">{quick}</div>
    </div>
  );
}
