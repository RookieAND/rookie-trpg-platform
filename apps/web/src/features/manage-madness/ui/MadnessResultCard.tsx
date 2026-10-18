"use client";
import { useState } from "react";
import type { MadnessResult } from "@coc-vtt/shared";
import { Dialog } from "@/shared/ui";

/** 광기 증상 굴림 결과. 시트 주인과 GM만 받는다. */
export function MadnessResultCard({ last }: { last: { result: MadnessResult; n: number } | null }) {
  const [closedN, setClosedN] = useState(0);
  const open = last !== null && last.n !== closedN;

  if (!open || !last) return null;
  const r = last.result;
  return (
    <Dialog label="광기 증상" onClose={() => setClosedN(last.n)} className="dialog" style={{ position: "fixed", top: "22%", left: "50%", right: "auto", transform: "translateX(-50%)" }}>
      <strong>{r.name} · 광기 증상</strong>
      <div style={{ fontSize: 16 }} data-testid="madness-symptom">{r.symptom}</div>
      <span style={{ color: "var(--muted)" }}>
        지속 {r.duration}{r.mode === "realtime" ? "라운드" : "시간"} ({r.mode === "realtime" ? "실시간" : "요약"})
      </span>
      <button className="btn" onClick={() => setClosedN(last.n)}>닫기</button>
    </Dialog>
  );
}
