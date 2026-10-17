"use client";
import { useRef, useState } from "react";
import { CREDIT_RATING, DEFAULT_SKILLS, MAX_OCCUPATION_SKILLS, OCCUPATION_POINT_FORMULAS, type Occupation, type OccupationFormulaId } from "@coc-vtt/shared";
import { downloadText } from "@/shared/lib";
import type { AddOccupationResult, ImportResult } from "../model/occupations";

const SKILL_NAMES = [...DEFAULT_SKILLS.map((s) => s.name), "회피"].filter((n) => n !== CREDIT_RATING && n !== "크툴루 신화");

/** 직업을 정의해 두는 곳: 이름, 직업 포인트 공식, 신용도 범위, 직업 기능. 캐릭터 생성 마법사에서 불러 쓴다. */
export function OccupationManager({ error: syncError, occupations, onAdd, onEdit, onRemove, exportText, importText }: { error?: string | null; occupations: Occupation[]; onAdd: (o: Omit<Occupation, "id">) => AddOccupationResult; onEdit: (id: string, o: Omit<Occupation, "id">) => AddOccupationResult; onRemove: (id: string) => void; exportText: () => string; importText: (text: string) => ImportResult }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [formula, setFormula] = useState<OccupationFormulaId>("edu4");
  const [creditMin, setCreditMin] = useState(0);
  const [creditMax, setCreditMax] = useState(99);
  const [skills, setSkills] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setName("");
    setFormula("edu4");
    setCreditMin(0);
    setCreditMax(99);
    setSkills([]);
    setEditingId(null);
    setError(null);
  };

  const add = () => {
    const input = { name, formula, creditMin, creditMax, skills };
    const r = editingId ? onEdit(editingId, input) : onAdd(input);
    if (!r.ok) return setError(r.message);
    reset();
  };

  const startEdit = (o: Occupation) => {
    setOpen(true);
    setEditingId(o.id);
    setName(o.name);
    setFormula(o.formula);
    setCreditMin(o.creditMin);
    setCreditMax(o.creditMax);
    setSkills(o.skills);
    setError(null);
    setInfo(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setInfo(null);
    const r = importText(await file.text());
    if (!r.ok) return setError(r.message);
    setError(null);
    setInfo(r.added === 0 ? "새로 들어온 직업이 없어요(이미 있거나 규칙에 맞지 않아요)." : `직업 ${r.added}개를 가져왔어요.${r.skipped ? ` ${r.skipped}개는 건너뛰었어요.` : ""}`);
  };

  return (
    <section className="card" style={{ gap: 12 }} data-testid="occupations">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ flex: 1 }}>내 직업 정의 ({occupations.length})</strong>
        <button className="btn" disabled={occupations.length === 0} onClick={() => downloadText(`occupations-${new Date().toISOString().slice(0, 10)}.json`, exportText(), "application/json;charset=utf-8")}>내보내기</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>가져오기</button>
        <input ref={fileRef} type="file" accept="application/json,.json" aria-label="직업 파일 가져오기" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="btn" aria-expanded={open} onClick={() => { if (open) reset(); setOpen((v) => !v); }}>{open ? "닫기" : "직업 정의하기"}</button>
      </div>
      {info && <div role="status" style={{ color: "var(--accent)", fontSize: 13 }}>{info}</div>}
      {syncError && <div className="err" role="alert">{syncError}</div>}
      {occupations.map((o) => (
        <div key={o.id} data-testid="occupation-item" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ flex: 1 }}>
            <strong>{o.name}</strong>
            <span style={{ color: "var(--muted)", fontSize: 12.5 }}> · {OCCUPATION_POINT_FORMULAS.find((f) => f.id === o.formula)?.label} · 신용도 {o.creditMin}~{o.creditMax} · {o.skills.join(", ") || "직업 기능 없음"}</span>
          </span>
          <button className="btn" aria-label={`${o.name} 직업 수정`} onClick={() => startEdit(o)}>수정</button>
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
          <div style={{ display: "flex", gap: 8 }}><button className="btn primary" onClick={add}>{editingId ? "수정 저장" : "직업 저장"}</button>{editingId && <button className="btn" onClick={reset}>수정 취소</button>}</div>
        </div>
      )}
    </section>
  );
}
