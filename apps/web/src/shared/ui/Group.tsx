"use client";
import { useId, useState, type ReactNode } from "react";

/**
 * 접고 펼 수 있는 묶음. 시트와 캐릭터 폼이 같은 모양의 구역 제목을 쓴다.
 * 접어도 안의 내용은 그대로 두고 숨기기만 해서, 쓰던 입력이 사라지지 않는다.
 */
export function Group({ title, meta, defaultOpen = true, actions, children, testId }: { title: string; meta?: ReactNode; defaultOpen?: boolean; actions?: ReactNode; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className="grp" data-testid={testId}>
      <div className="grp-head">
        <h3 className="grp-h">
          <button type="button" className="grp-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
            <span className="grp-caret" aria-hidden>{open ? "▾" : "▸"}</span>
            <span>{title}</span>
            {meta !== undefined && <span className="count">{meta}</span>}
          </button>
        </h3>
        {actions && <div className="grp-actions">{actions}</div>}
      </div>
      <div id={bodyId} className="grp-body" hidden={!open}>{children}</div>
    </section>
  );
}
