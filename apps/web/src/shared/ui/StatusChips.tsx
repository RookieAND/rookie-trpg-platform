"use client";
import { STATUS_LABEL_KO, type StatusKey } from "@coc-vtt/shared";

/** 부상 상태 칩(부상·중상·기절·빈사·사망). 시트와 전투 순서가 같은 모양을 쓴다. */
export function StatusChips({ keys, testId = "status-chips" }: { keys: readonly StatusKey[]; testId?: string }) {
  if (keys.length === 0) return null;
  return (
    <span className="st-row" data-testid={testId} role="list" aria-label="상태">
      {keys.map((k) => (
        <span key={k} role="listitem" className={`st st-${k}`} data-status={k}>
          {STATUS_LABEL_KO[k]}
        </span>
      ))}
    </span>
  );
}
