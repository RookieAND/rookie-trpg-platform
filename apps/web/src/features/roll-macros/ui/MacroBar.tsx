"use client";
import { useState } from "react";
import { MAX_MACROS, type AddResult, type Macro } from "../model/macros";

/** 자주 굴리는 식을 이름 붙여 두고 한 번에 굴리는 줄. */
export function MacroBar({ error: syncError, macros, isKp, disabled, onRoll, onAdd, onRemove }: { error?: string | null; macros: Macro[]; isKp: boolean; disabled: boolean; onRoll: (m: Macro) => void; onAdd: (i: { name: string; expr: string; secret: boolean }) => AddResult; onRemove: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [expr, setExpr] = useState("");
  const [secret, setSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const r = onAdd({ name, expr, secret: isKp && secret });
    if (!r.ok) return setError(r.message);
    setName("");
    setExpr("");
    setSecret(false);
    setError(null);
  };

  return (
    <div style={{ display: "grid", gap: 6, padding: "8px 16px", borderTop: "1px solid var(--line)" }} data-testid="macro-bar">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {macros.map((m) => (
          <span key={m.id} style={{ display: "inline-flex", gap: 2 }}>
            <button className="btn" style={{ height: 26, padding: "0 10px" }} disabled={disabled} title={`${m.expr}${m.secret ? " (비밀)" : ""}`} data-testid="macro" onClick={() => onRoll(m)}>
              {m.secret && "🔒 "}{m.name}
            </button>
            {editing && <button className="btn" style={{ height: 26, padding: "0 6px" }} aria-label={`${m.name} 매크로 삭제`} onClick={() => onRemove(m.id)}>×</button>}
          </span>
        ))}
        {macros.length === 0 && !editing && <span style={{ color: "var(--muted)", fontSize: 12 }}>자주 쓰는 굴림을 매크로로 저장해 보세요.</span>}
        <button className="btn" style={{ height: 26, padding: "0 10px", marginLeft: "auto" }} aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
          {editing ? "닫기" : "매크로 편집"}
        </button>
      </div>
      {syncError && <div className="err" role="alert">{syncError}</div>}
      {editing && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" style={{ width: 110 }} aria-label="매크로 이름" placeholder="이름" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
            <input className="input mono" aria-label="매크로 굴림 식" placeholder="1d6+2" value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            <button className="btn" onClick={add} disabled={macros.length >= MAX_MACROS}>저장</button>
          </div>
          {isKp && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} style={{ accentColor: "#5fd3a4" }} />
              비밀 굴림으로 굴리기
            </label>
          )}
          {error && <div className="err" role="alert">{error}</div>}
        </div>
      )}
    </div>
  );
}
