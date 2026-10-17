"use client";
import { useState } from "react";
import { CREDIT_RATING, DEFAULT_SKILLS, MAX_OCCUPATION_SKILLS, OCCUPATION_POINT_FORMULAS, type Occupation, type OccupationFormulaId } from "@coc-vtt/shared";
import type { AddOccupationResult } from "../model/occupations";

const SKILL_NAMES = [...DEFAULT_SKILLS.map((s) => s.name), "회피"].filter((n) => n !== CREDIT_RATING && n !== "크툴루 신화");

/** 직업을 정의해 두는 곳: 이름, 직업 포인트 공식, 신용도 범위, 직업 기능. 캐릭터 생성 마법사에서 불러 쓴다. */
export function OccupationManager({ error: syncError, occupations, onAdd, onRemove }: { error?: string | null; occupations: Occupation[]; onAdd: (o: Omit<Occupation, "id">) => AddOccupationResult; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [formula, setFormula] = useState<OccupationFormulaId>("edu4");
  const [creditMin, setCreditMin] = useState(0);
  const [creditMax, setCreditMax] = useState(99);
  const [skills, setSkills] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const r = onAdd({ name, formula, creditMin, creditMax, skills });
    if (!r.ok) return setError(r.message);
    setName("");
    setSkills([]);
    setError(null);
  };

  return (
    <section className="card" style={{ gap: 12 }} data-testid="occupations">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ flex: 1 }}>내 직업 정의 ({occupations.length})</strong>
        <button className="btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "닫기" : "직업 정의하기"}</button>
      </div>
      {syncError && <div className="err" role="alert">{syncError}</div>}
      {occupations.map((o) => (
        <div key={o.id} data-testid="occupation-item" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ flex: 1 }}>
            <strong>{o.name}</strong>
            <span style={{ color: "var(--muted)", fontSize: 12.5 }}> · {OCCUPATION_POINT_FORMULAS.find((f) => f.id === o.formula)?.label} · 신용도 {o.creditMin}~{o.creditMax} · {o.skills.join(", ") || "직업 기능 없음"}</span>
          </span>
          <button className="btn danger" aria-label={`${o.name} 직업 삭제`} onClick={() => onRemove(o.id)}>삭제</button>
        </div>
      ))}
      {open && (
        <div style={{ display: "grid", gap: 10 }}>
          <input className="input" aria-label="직업 이름" placeholder="직업 이름" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select className="input" style={{ width: "auto" }} aria-label="정의의 직업 포인트 공식" value={formula} onChange={(e) => setFormula(e.target.value as OccupationFormulaId)}>
              {OCCUPATION_POINT_FORMULAS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>신용도
              <input className="input mono" style={{ width: 70 }} aria-label="신용도 최소" type="number" min={0} max={99} value={creditMin} onChange={(e) => setCreditMin(Number(e.target.value))} />~
              <input className="input mono" style={{ width: 70 }} aria-label="신용도 최대" type="number" min={0} max={99} value={creditMax} onChange={(e) => setCreditMax(Number(e.target.value))} />
            </label>
          </div>
          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8, display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
            <legend style={{ fontSize: 12, color: "var(--muted)" }}>직업 기능 ({skills.length}/{MAX_OCCUPATION_SKILLS}) · 신용도는 늘 포함돼요</legend>
            {SKILL_NAMES.map((s) => (
              <label key={s} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" checked={skills.includes(s)} disabled={!skills.includes(s) && skills.length >= MAX_OCCUPATION_SKILLS} onChange={(e) => setSkills(e.target.checked ? [...skills, s] : skills.filter((x) => x !== s))} style={{ accentColor: "#5fd3a4" }} />
                {s}
              </label>
            ))}
          </fieldset>
          {error && <div className="err" role="alert">{error}</div>}
          <div><button className="btn primary" onClick={add}>직업 저장</button></div>
        </div>
      )}
    </section>
  );
}
