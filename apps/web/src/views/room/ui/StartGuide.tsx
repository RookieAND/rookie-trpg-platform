"use client";

/** GM이 처음 룸에 들어왔을 때 무엇을 어디서 하는지 알려 주는 체크리스트. 끝낸 단계는 자동으로 체크된다. */
export function StartGuide({ steps, onClose }: { steps: Array<{ done: boolean; title: string; hint: string }>; onClose: () => void }) {
  return (
    <section className="guide" role="status" aria-label="시작 가이드">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 style={{ flex: 1 }}>세션 시작 전이에요 · 이렇게 준비해 보세요</h2>
        <button className="btn sm ghost" onClick={onClose} aria-label="가이드 닫기">닫기</button>
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={i} data-done={s.done}>
            <span className="check" aria-hidden>✓</span>
            <span>
              <b>{s.title}</b>
              <div className="hint">{s.hint}</div>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
