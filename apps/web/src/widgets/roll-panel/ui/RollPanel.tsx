"use client";
import { useState } from "react";
import { describeOutcome, formatRollLog, luckNeeded, type Character, type RollLogEntry } from "@coc-vtt/shared";
import { MacroBar, useRollMacros } from "@/features/roll-macros";
import type { Caller } from "@/shared/api";
import { downloadText } from "@/shared/lib";

interface Props {
  me: Caller;
  rolls: RollLogEntry[];
  userId: string;
  characters: Character[];
  hidden: Array<{ id: string; userName: string }>;
  isKp: boolean;
  disabled: boolean;
  error: string | null;
  /** false를 돌려주면 보내지 못한 것이라 식을 지우지 않는다. */
  onRoll: (expr: string, secret: boolean) => unknown;
  onPush: (rollId: string) => void;
  onLuck: (rollId: string) => void;
}

export function RollPanel({ me, rolls, userId, characters, hidden, isKp, disabled, error, onRoll, onPush, onLuck }: Props) {
  const [expr, setExpr] = useState("");
  const [secret, setSecret] = useState(false);
  const macro = useRollMacros(me);

  const submit = () => {
    if (!expr.trim() || disabled) return;
    if (onRoll(expr.trim(), secret) !== false) setExpr("");
  };

  // 실패한 시트 판정에는 굴린 사람(또는 KP)이 푸시하거나 행운을 쓸 수 있다.
  const actions = (r: RollLogEntry) => {
    if (!r.check || r.secret || r.outcome.kind !== "cc" || r.outcome.success !== false) return null;
    if (r.userId !== userId && !isKp) return null;
    const pushed = rolls.some((x) => x.pushOf === r.id);
    const luckUsed = rolls.some((x) => x.luckOf === r.id);
    if (luckUsed) return null;
    const need = luckNeeded(r.outcome);
    const luck = characters.find((c) => c.id === r.check?.characterId)?.luck ?? 0;
    return (
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        {!r.pushOf && !pushed && (
          <button className="btn" style={{ height: 26, padding: "0 10px" }} disabled={disabled} onClick={() => onPush(r.id)}>푸시</button>
        )}
        {need !== null && !pushed && (
          <button className="btn" style={{ height: 26, padding: "0 10px" }} disabled={disabled || luck < need} title={luck < need ? `행운이 모자라요 (보유 ${luck})` : undefined} onClick={() => onLuck(r.id)}>
            행운 {need} 쓰기
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="log" data-testid="roll-log" aria-live="polite">
        {rolls.length === 0 && hidden.length === 0 && <div style={{ color: "var(--muted)" }}>아직 굴림이 없어요.</div>}
        {[...rolls].reverse().map((r) => (
          <div key={r.id} className="log-item" data-testid="roll-entry">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <strong>{r.userName}</strong>
              {r.label && <span style={{ color: "var(--muted)" }}>{r.label}</span>}
              {r.secret && <span className="badge paused">비밀 굴림</span>}
              {r.pushOf && <span className="badge">푸시</span>}
              {r.luckOf && <span className="badge">행운</span>}
              <span className="mono" style={{ color: "var(--muted)", marginLeft: "auto" }}>{r.expr}</span>
            </div>
            <div className="mono">{describeOutcome(r.outcome)}</div>
            {actions(r)}
          </div>
        ))}
        {hidden.map((h) => (
          <div key={h.id} className="log-item" data-testid="roll-hidden" style={{ color: "var(--muted)" }}>
            {h.userName}님이 비밀 굴림을 했어요.
          </div>
        ))}
      </div>
      <MacroBar error={macro.error} macros={macro.macros} isKp={isKp} disabled={disabled} onRoll={(m) => onRoll(m.expr, isKp && m.secret)} onAdd={macro.add} onRemove={macro.remove} />
      <div className="compose">
        {isKp && (
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} style={{ accentColor: "#7c86f7" }} />
            비밀 굴림 (결과는 KP에게만 보여요)
          </label>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input mono"
            aria-label="굴림 식"
            placeholder="CC<=60 또는 1d100"
            value={expr}
            disabled={disabled}
            onChange={(e) => setExpr(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <button className="btn primary" onClick={submit} disabled={disabled || !expr.trim()}>굴리기</button>
        </div>
        {error && <div className="err" role="alert">{error}</div>}
        <button
          className="btn"
          style={{ height: 28 }}
          disabled={rolls.length === 0}
          title="이 화면에서 볼 수 있었던 굴림을 마크다운 파일로 저장해요"
          onClick={() => {
            const d = new Date();
            const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
            downloadText(`roll-log-${day}.md`, formatRollLog(rolls, { title: "굴림 기록", isKp }));
          }}
        >
          굴림 기록 저장
        </button>
      </div>
    </>
  );
}
