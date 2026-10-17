"use client";
import { useState } from "react";
import type { Beat, Branch, BranchCondition, Handout } from "@coc-vtt/shared";

type Kind = BranchCondition["type"];
const KIND_LABEL: Record<Kind, string> = { manual: "수동 (KP가 누름)", roll: "판정 결과", stat: "수치 임계", handout: "핸드아웃 공개" };

export interface BranchDraft {
  id?: string;
  from: string;
  to: string;
  label: string;
  condition: BranchCondition;
}

/** 비트 사이의 분기 하나를 쓴다. 판정·수치·핸드아웃 조건이 맞으면 서버가 KP에게 제안한다. */
export function BranchEditor({ initial, fromId, beats, handouts, onSave, onCancel }: { initial?: Branch; fromId: string; beats: Beat[]; handouts: Handout[]; onSave: (d: BranchDraft) => void; onCancel: () => void }) {
  const others = beats.filter((b) => b.id !== fromId);
  const c0 = initial?.condition;
  const [to, setTo] = useState(initial?.to ?? others[0]?.id ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [kind, setKind] = useState<Kind>(c0?.type ?? "manual");
  const [skill, setSkill] = useState(c0?.type === "roll" ? c0.skill : "");
  const [atLeast, setAtLeast] = useState<"regular" | "hard" | "extreme" | "critical">(c0?.type === "roll" ? c0.atLeast : "hard");
  const [stat, setStat] = useState<"hp" | "san" | "luck">(c0?.type === "stat" ? c0.stat : "san");
  const [atMost, setAtMost] = useState(String(c0?.type === "stat" ? c0.atMost : 0));
  const [handoutId, setHandoutId] = useState(c0?.type === "handout" ? c0.handoutId : (handouts[0]?.id ?? ""));

  const condition = (): BranchCondition | null => {
    if (kind === "manual") return { type: "manual" };
    if (kind === "roll") return skill.trim() ? { type: "roll", skill: skill.trim(), atLeast } : null;
    if (kind === "stat") {
      const v = Number(atMost);
      return Number.isInteger(v) && v >= 0 && v <= 999 ? { type: "stat", stat, atMost: v } : null;
    }
    return handoutId ? { type: "handout", handoutId } : null;
  };
  const cond = condition();
  const valid = label.trim().length > 0 && to !== "" && cond !== null;

  return (
    <div style={{ display: "grid", gap: 10 }} data-testid="branch-editor">
      <input className="input" aria-label="분기 이름" placeholder="분기 이름 (예: 지하실 문을 연다)" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
      <select className="input" aria-label="이동할 비트" value={to} onChange={(e) => setTo(e.target.value)}>
        {others.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      <select className="input" aria-label="분기 조건" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <option key={k} value={k} disabled={k === "handout" && handouts.length === 0}>{KIND_LABEL[k]}</option>
        ))}
      </select>
      {kind === "roll" && (
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" style={{ flex: 1 }} aria-label="조건 기능 이름" placeholder="기능 이름 (예: 도서관 이용)" value={skill} onChange={(e) => setSkill(e.target.value)} />
          <select className="input" aria-label="조건 판정 단계" value={atLeast} onChange={(e) => setAtLeast(e.target.value as typeof atLeast)}>
            <option value="regular">보통 이상</option>
            <option value="hard">어려움 이상</option>
            <option value="extreme">극단 이상</option>
            <option value="critical">대성공</option>
          </select>
        </div>
      )}
      {kind === "stat" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="input" aria-label="조건 수치" value={stat} onChange={(e) => setStat(e.target.value as typeof stat)}>
            <option value="san">SAN</option>
            <option value="hp">HP</option>
            <option value="luck">행운</option>
          </select>
          <input className="input mono" style={{ width: 80 }} type="number" aria-label="조건 기준값" value={atMost} onChange={(e) => setAtMost(e.target.value)} />
          <span>이하</span>
        </div>
      )}
      {kind === "handout" && (
        <select className="input" aria-label="조건 핸드아웃" value={handoutId} onChange={(e) => setHandoutId(e.target.value)}>
          {handouts.map((h) => (
            <option key={h.id} value={h.id}>{h.title}</option>
          ))}
        </select>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>취소</button>
        <button className="btn primary" disabled={!valid} onClick={() => cond && onSave({ ...(initial ? { id: initial.id } : {}), from: fromId, to, label: label.trim(), condition: cond })}>저장</button>
      </div>
    </div>
  );
}
