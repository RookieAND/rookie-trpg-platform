"use client";
import { useState } from "react";
import { MADNESS_LABEL_KO, maxLoss, parseSanLoss, type Character, type Madness } from "@coc-vtt/shared";
import { Dialog, Hint, Select } from "@/shared/ui";

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
  const [loss, setLoss] = useState("");
  // SAN 체크는 되돌릴 수 없어서, 굴리기 전에 값을 한 번 더 보여 주고 확정을 받는다.
  const [confirming, setConfirming] = useState(false);
  const day = c.sanDay ?? { start: c.san, lost: 0 };
  const threshold = Math.floor(day.start / 5);
  const bad = !/^\s*[^/\s][^/]*\/[^/\s][^/]*\s*$/.test(loss);
  const parsed = bad ? null : parseSanLoss(loss);
  const worst = parsed?.ok ? Math.min(c.san, Math.max(maxLoss(parsed.success), maxLoss(parsed.failure))) : null;
  const ask = () => canAct && !bad && setConfirming(true);
  const run = () => {
    setConfirming(false);
    onCheck(loss.trim());
  };

  return (
    <div className="sheet-sec" data-testid="san-panel">
      <div className="section-title">SAN</div>
      <div className="row">
        <input
          className="input"
          aria-label="SAN 손실"
          value={loss}
          maxLength={30}
          onChange={(e) => {
            setLoss(e.target.value);
            setConfirming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask();
            if (e.key === "Escape") setConfirming(false);
          }}
          placeholder="성공 시/실패 시 (예: 0/1d6)"
        />
        <Hint term="sanLoss" />
        <button className="btn" disabled={!canAct || bad || confirming} onClick={ask}>SAN 체크</button>
      </div>
      {confirming && (
        <Dialog label="SAN 체크 확인" onClose={() => setConfirming(false)} className="card" data-testid="san-confirm" style={{ padding: 10, gap: 6 }}>
          <span>
            SAN 체크 <b className="mono">{loss.trim()}</b> · 지금 SAN <b className="mono">{c.san}</b>
          </span>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
            굴리면 되돌릴 수 없어요.{worst !== null && worst > 0 ? ` 최악이면 SAN이 ${c.san - worst}까지 내려가요.` : ""}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" onClick={run}>SAN 체크 굴리기</button>
            <button className="btn" onClick={() => setConfirming(false)}>취소</button>
          </span>
        </Dialog>
      )}
      <div className="row" style={{ color: "var(--muted)", fontSize: 12.5 }}>
        <span data-testid="san-day">오늘 손실 {day.lost}{threshold > 0 ? ` / ${threshold}` : ""}</span>
        <Hint term="sanDay" />
        {c.madness && c.madness !== "none" && (
          <span className="badge" role="status" style={{ color: "var(--danger)" }} data-testid="madness-badge">
            <Hint term={c.madness}>{MADNESS_LABEL_KO[c.madness]}</Hint>
          </span>
        )}
        <Hint term="manualSan">SAN·HP를 직접 바꾸면?</Hint>
        {isKp && (
          <Select className="input" style={{ width: "auto" }} aria-label="광기 상태" value={c.madness ?? "none"} onChange={(e) => onSetMadness(e.target.value as Madness)}>
            <option value="none">정상</option>
            <option value="temporary">{MADNESS_LABEL_KO.temporary}</option>
            <option value="indefinite">{MADNESS_LABEL_KO.indefinite}</option>
            <option value="permanent">{MADNESS_LABEL_KO.permanent}</option>
          </Select>
        )}
        {isKp && (
          <button className="btn sm" onClick={onNewDay}>하루 지남</button>
        )}
        {isKp && c.madness && c.madness !== "none" && (
          <>
            <button className="btn sm" onClick={() => onMadnessRoll("realtime")}>증상 굴리기(실시간)</button>
            <button className="btn sm" onClick={() => onMadnessRoll("summary")}>증상 굴리기(요약)</button>
          </>
        )}
      </div>
    </div>
  );
}
