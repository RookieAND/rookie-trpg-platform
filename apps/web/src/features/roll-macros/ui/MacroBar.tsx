"use client";
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { MAX_MACROS, type AddResult, type Macro } from "../model/macros";

/** 자주 굴리는 식을 이름 붙여 두고 한 번에 굴리는 줄. */
export function MacroBar({ error: syncError, macros, isKp, readOnly = false, disabled, onRoll, onAdd, onRemove }: { error?: string | null; macros: Macro[]; isKp: boolean; /** 관전자: 매크로를 고치는 줄을 숨긴다 */ readOnly?: boolean; disabled: boolean; onRoll: (m: Macro) => void; onAdd: (i: { name: string; expr: string; secret: boolean }) => AddResult; onRemove: (id: string) => void }) {
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
    <div className="macro-bar" data-testid="macro-bar">
      <div className="row">
        {macros.map((m) => (
          <span key={m.id} className="macro-chip">
            <button className="btn sm" disabled={disabled} title={`${m.expr}${m.secret ? " (비밀)" : ""}`} data-testid="macro" onClick={() => onRoll(m)}>
              {m.secret && "🔒 "}{m.name}
            </button>
            {editing && <button className="btn sm ghost" aria-label={`${m.name} 매크로 삭제`} onClick={() => onRemove(m.id)}>×</button>}
          </span>
        ))}
        {!readOnly && <button className="btn sm ghost" style={macros.length ? { marginLeft: "auto" } : undefined} title="자주 굴리는 식을 이름 붙여 저장해요" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
          <SlidersHorizontal aria-hidden />{editing ? "닫기" : "매크로 편집"}
        </button>}
      </div>
      {syncError && <div className="err" role="alert">{syncError}</div>}
      {editing && !readOnly && (
        <div className="macro-edit">
          <div className="row">
            <input className="input" style={{ width: 96, flex: "none" }} aria-label="매크로 이름" placeholder="이름" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
            <input className="input mono" aria-label="매크로 굴림 식" placeholder="1d6+2" value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            <button className="btn" onClick={add} disabled={macros.length >= MAX_MACROS}>저장</button>
          </div>
          {isKp && (
            <label className="check">
              <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} style={{ accentColor: "#7c86f7" }} />
              비밀 굴림으로 굴리기
            </label>
          )}
          {error && <div className="err" role="alert">{error}</div>}
        </div>
      )}
    </div>
  );
}
