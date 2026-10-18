"use client";
import { useState } from "react";
import { MAX_WEAPONS, SKILL_CAP, isDamageExpr, type Weapon } from "@coc-vtt/shared";

/** GM이 기능 값을 바로 고치는 칸. Enter나 칸을 벗어나면 적용한다. */
export function SkillValueInput({ name, value, disabled, onCommit }: { name: string; value: number; disabled?: boolean; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) return setText(String(value));
    const next = Math.min(SKILL_CAP, Math.max(0, Math.round(n)));
    setText(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      className="input mono skill-val"
      type="number"
      min={0}
      max={SKILL_CAP}
      aria-label={`${name} 값 고치기`}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())}
    />
  );
}

/** GM이 기능을 새로 넣거나 이미 있는 기능의 값을 정한다. */
export function SkillAdd({ disabled, onAdd }: { disabled?: boolean; onAdd: (name: string, value: number) => void }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("40");
  const n = Number(value);
  const ok = name.trim().length > 0 && name.trim().length <= 30 && value.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= SKILL_CAP;
  const add = () => {
    if (!ok) return;
    onAdd(name.trim(), Math.round(n));
    setName("");
  };
  return (
    <div className="row gm-add" data-testid="skill-add">
      <input className="input" style={{ flex: 1, minWidth: 0 }} aria-label="새 기능 이름" placeholder="기능 이름(예: 크툴루 신화)" value={name} maxLength={30} disabled={disabled} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <input className="input mono skill-val" type="number" min={0} max={SKILL_CAP} aria-label="새 기능 값" value={value} disabled={disabled} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <button className="btn sm" disabled={disabled || !ok} onClick={add}>기능 넣기</button>
    </div>
  );
}

/** GM이 무기를 추가한다. 기능은 시트에 있는 기능 중에서 고르고, 피해는 1d6+db 같은 식이다. */
export function WeaponAdd({ skills, count, disabled, onAdd }: { skills: string[]; count: number; disabled?: boolean; onAdd: (w: Weapon) => void }) {
  const [name, setName] = useState("");
  const [skill, setSkill] = useState("");
  const [damage, setDamage] = useState("1d6+db");
  const chosen = skill || (skills.includes("맨손 격투") ? "맨손 격투" : (skills[0] ?? ""));
  const badDamage = damage.trim() !== "" && !isDamageExpr(damage.trim());
  const ok = name.trim().length > 0 && chosen !== "" && damage.trim() !== "" && !badDamage && count < MAX_WEAPONS;
  const add = () => {
    if (!ok) return;
    onAdd({ name: name.trim(), skill: chosen, damage: damage.trim() });
    setName("");
  };
  return (
    <div className="gm-add" data-testid="weapon-add">
      <div className="row">
        <input className="input" style={{ flex: 1, minWidth: 0 }} aria-label="새 무기 이름" placeholder="무기 이름" value={name} maxLength={30} disabled={disabled} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <select className="input" style={{ flex: 1, minWidth: 0 }} aria-label="새 무기 기능" value={chosen} disabled={disabled} onChange={(e) => setSkill(e.target.value)}>
          {skills.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="row">
        <input className="input mono" style={{ flex: 1, minWidth: 0 }} aria-label="새 무기 피해" placeholder="1d6+db" value={damage} maxLength={40} disabled={disabled} aria-invalid={badDamage || undefined} onChange={(e) => setDamage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn sm" disabled={disabled || !ok} onClick={add}>무기 넣기</button>
      </div>
      {badDamage && <div className="why" role="alert">피해는 1d6+db처럼 주사위 식으로 적어 주세요.</div>}
      {count >= MAX_WEAPONS && <div className="why">무기는 {MAX_WEAPONS}개까지예요.</div>}
    </div>
  );
}
