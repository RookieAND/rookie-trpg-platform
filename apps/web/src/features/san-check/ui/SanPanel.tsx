"use client";
import { useState } from "react";
import { MADNESS_LABEL_KO, type Character, type Madness } from "@coc-vtt/shared";

interface Props {
  character: Character;
  canAct: boolean;
  isKp: boolean;
  onCheck: (loss: string) => void;
  onSetMadness: (kind: Madness) => void;
  onNewDay: () => void;
  onMadnessRoll: (mode: "realtime" | "summary") => void;
}

/** SAN 체크 입력, 광기 상태, 하루 손실. 손실은 "성공 시/실패 시"로 적는다. */
export function SanPanel({ character: c, canAct, isKp, onCheck, onSetMadness, onNewDay, onMadnessRoll }: Props) {
  const [loss, setLoss] = useState("0/1d6");
  const day = c.sanDay ?? { start: c.san, lost: 0 };
  const threshold = Math.floor(day.start / 5);
  const bad = !/^\s*[^/\s][^/]*\/[^/\s][^/]*\s*$/.test(loss);

  return (
    <div style={{ display: "grid", gap: 8 }} data-testid="san-panel">
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="input"
          aria-label="SAN 손실"
          value={loss}
          maxLength={30}
          onChange={(e) => setLoss(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canAct && !bad && onCheck(loss.trim())}
          placeholder="성공 시/실패 시 (예: 0/1d6)"
        />
        <button className="btn primary" disabled={!canAct || bad} onClick={() => onCheck(loss.trim())}>SAN 체크</button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", color: "var(--muted)", fontSize: 12.5 }}>
        <span data-testid="san-day">오늘 손실 {day.lost}{threshold > 0 ? ` / ${threshold}` : ""}</span>
        {c.madness && c.madness !== "none" && (
          <span className="badge" role="status" style={{ color: "var(--danger)" }} data-testid="madness-badge">{MADNESS_LABEL_KO[c.madness]}</span>
        )}
        {isKp && (
          <select className="input" style={{ height: 24, padding: "0 6px" }} aria-label="광기 상태" value={c.madness ?? "none"} onChange={(e) => onSetMadness(e.target.value as Madness)}>
            <option value="none">정상</option>
            <option value="temporary">{MADNESS_LABEL_KO.temporary}</option>
            <option value="indefinite">{MADNESS_LABEL_KO.indefinite}</option>
            <option value="permanent">{MADNESS_LABEL_KO.permanent}</option>
          </select>
        )}
        {isKp && (
          <button className="btn" style={{ height: 24, padding: "0 8px" }} onClick={onNewDay}>하루 지남</button>
        )}
        {isKp && c.madness && c.madness !== "none" && (
          <>
            <button className="btn" style={{ height: 24, padding: "0 8px" }} onClick={() => onMadnessRoll("realtime")}>증상 굴리기(실시간)</button>
            <button className="btn" style={{ height: 24, padding: "0 8px" }} onClick={() => onMadnessRoll("summary")}>증상 굴리기(요약)</button>
          </>
        )}
      </div>
    </div>
  );
}
