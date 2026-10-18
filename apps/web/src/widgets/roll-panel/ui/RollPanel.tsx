"use client";
import { useState } from "react";
import { formatRollLog, luckBlockReason, luckNeeded, pushBlockReason, type Character, type RollLogEntry, type RollRuleInput } from "@coc-vtt/shared";
import { MacroBar, useRollMacros } from "@/features/roll-macros";
import type { Caller } from "@/shared/api";
import { downloadText } from "@/shared/lib";
import { Hint } from "@/shared/ui";
import { RollResult } from "./RollResult";

interface Props {
  me: Caller;
  rolls: RollLogEntry[];
  userId: string;
  characters: Character[];
  hidden: Array<{ id: string; userName: string }>;
  isKp: boolean;
  disabled: boolean;
  error: string | null;
  onRoll: (expr: string, secret: boolean) => void;
  onPush: (rollId: string) => void;
  onLuck: (rollId: string) => void;
}

export function RollPanel({ me, rolls, userId, characters, hidden, isKp, disabled, error, onRoll, onPush, onLuck }: Props) {
  const [expr, setExpr] = useState("");
  const [secret, setSecret] = useState(false);
  const macro = useRollMacros(me);

  const submit = () => {
    if (!expr.trim() || disabled) return;
    onRoll(expr.trim(), secret);
    setExpr("");
  };

  // 실패한 시트 판정에는 굴린 사람(또는 KP)이 푸시하거나 행운을 쓸 수 있다. 규칙상 안 되는 것은 이유를 보여 준다.
  const actions = (r: RollLogEntry) => {
    if (!r.check || r.secret || r.outcome.kind !== "cc" || r.outcome.success !== false) return null;
    if (r.userId !== userId && !isKp) return null;
    const c = characters.find((x) => x.id === r.check?.characterId);
    const input: RollRuleInput = {
      name: r.check.name,
      outcome: r.outcome,
      isPush: Boolean(r.pushOf),
      pushed: rolls.some((x) => x.pushOf === r.id),
      luckUsed: rolls.some((x) => x.luckOf === r.id),
      weaponSkills: (c?.weapons ?? []).map((w) => w.skill),
    };
    const pushWhy = pushBlockReason(input);
    const luckWhy = luckBlockReason(input);
    const need = luckNeeded(r.outcome);
    const luck = c?.luck ?? 0;
    // 이미 푸시했거나 행운을 쓴 뒤에는 조용히 둔다. 그 밖의 금지 사유는 한 줄로 알린다.
    const done = input.pushed || input.luckUsed || input.isPush;
    const notes = done ? [] : [pushWhy, luckWhy].filter((w, i, a): w is string => Boolean(w) && a.indexOf(w) === i);
    return (
      <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!pushWhy && (
            <>
              <button className="btn" style={{ height: 26, padding: "0 10px" }} disabled={disabled} title="같은 조건으로 한 번 더 굴려요. 또 실패하면 더 나쁜 일이 생길 수 있어요." onClick={() => onPush(r.id)}>푸시</button>
              <Hint term="push" />
            </>
          )}
          {!luckWhy && need !== null && (
            <>
              <button className="btn" style={{ height: 26, padding: "0 10px" }} disabled={disabled || luck < need} title={luck < need ? `행운이 모자라요 (보유 ${luck})` : `행운 ${need}을 깎아 성공으로 바꿔요`} onClick={() => onLuck(r.id)}>
                행운 {need} 쓰기
              </button>
              <Hint term="luck" />
              {luck < need && <span className="res-sub">행운이 모자라요 (보유 {luck})</span>}
            </>
          )}
        </div>
        {notes.map((w) => (
          <div key={w} className="res-sub" data-testid="rule-note">{w}</div>
        ))}
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
            <RollResult outcome={r.outcome} />
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
        <div className="res-sub" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>성공 단계<Hint term="level" /></span>
          <span>보너스·페널티<Hint term="bonus" /></span>
          <span>푸시<Hint term="push" /></span>
          <span>행운<Hint term="luck" /></span>
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
