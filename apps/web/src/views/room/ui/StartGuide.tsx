"use client";
import { useState } from "react";

/**
 * GM이 처음 룸에 들어왔을 때 무엇을 어디서 하는지 알려 주는 체크리스트. 끝낸 단계는 자동으로 체크된다.
 * 지도를 가리지 않도록 오른쪽 위에 작게 두고, 다음에 할 일 하나만 설명을 펼친다. 접으면 진행 수만 남는다.
 */
export function StartGuide({ steps, onClose }: { steps: Array<{ done: boolean; title: string; hint: string }>; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);
  return (
    <section className="guide" role="status" aria-label="시작 가이드" data-open={open}>
      <div className="guide-head">
        <h2>세션 시작 전이에요 <span className="guide-count">{doneCount}/{steps.length}</span></h2>
        <button className="btn sm ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "접기" : "펴기"}</button>
        <button className="btn sm ghost" onClick={onClose} aria-label="가이드 닫기">닫기</button>
      </div>
      {open && (
        <ol>
          {steps.map((s, i) => (
            <li key={i} data-done={s.done} data-next={i === next}>
              <span className="check" aria-hidden>✓</span>
              <span className="guide-text">
                <b>{s.title}</b>
                {i === next && <span className="hint">{s.hint}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
