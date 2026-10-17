"use client";
import { useEffect, useState } from "react";
import type { EndSummary } from "@coc-vtt/shared";

/** 세션이 끝나면 모두에게 정산 결과를 보여 준다. 엔딩 이름, SAN 보상, 성장 굴림이 있을 때만 뜬다. */
export function EndSummaryCard({ summary }: { summary: EndSummary | null }) {
  const [closed, setClosed] = useState<EndSummary | null>(null);
  const has = summary && (summary.ending || summary.sanRewards?.length || summary.growth?.length);
  const open = Boolean(has) && closed !== summary;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setClosed(summary);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, summary]);

  if (!open || !summary) return null;
  return (
    <div className="dialog" role="dialog" aria-label="세션 정산" style={{ position: "fixed", top: "22%", left: "50%", right: "auto", transform: "translateX(-50%)", maxHeight: "60vh", overflow: "auto" }}>
      <strong>{summary.ending ? `엔딩 · ${summary.ending}` : "세션 정산"}</strong>
      {!!summary.sanRewards?.length && (
        <section style={{ display: "grid", gap: 4 }}>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>SAN 보상</span>
          {summary.sanRewards.map((r) => (
            <div key={r.characterId}>{r.name}: +{r.roll} ({r.before} → {r.after})</div>
          ))}
        </section>
      )}
      {!!summary.growth?.length && (
        <section style={{ display: "grid", gap: 4 }}>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>성장 굴림</span>
          {summary.growth.map((g, i) => (
            <div key={`${g.characterId}-${g.skill}-${i}`}>
              {g.name} · {g.skill}: {g.roll} → {g.success ? `성장 ${g.before} → ${g.after}` : "그대로"}
            </div>
          ))}
        </section>
      )}
      <button className="btn" onClick={() => setClosed(summary)}>닫기</button>
    </div>
  );
}
