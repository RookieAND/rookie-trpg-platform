"use client";
import { useState } from "react";
import { CHARACTERISTIC_KEYS, defaultSkillValues, deriveCharacter, rollCharacteristics, type CharacterInput, type CharacteristicKey } from "@coc-vtt/shared";

const DEFAULT: CharacterInput = {
  name: "",
  age: 25,
  occupation: "",
  characteristics: { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 },
  luck: 50,
  skills: [],
  notes: "",
  backstory: "",
  possessions: "",
  weapons: [],
};

const num = (v: string) => (v === "" ? 0 : Number(v));

/** 보관함 캐릭터를 만들거나 고치는 폼. 생성 마법사는 따로 붙는다. */
export function CharacterForm({ initial, onSubmit, onCancel }: { initial?: CharacterInput; onSubmit: (data: CharacterInput) => Promise<void> | void; onCancel: () => void }) {
  const [c, setC] = useState<CharacterInput>(initial ?? DEFAULT);
  const [busy, setBusy] = useState(false);
  const ch = c.characteristics;
  const derived = deriveCharacter({ characteristics: ch, age: c.age });
  const skills = c.skills ?? [];
  const weapons = c.weapons ?? [];
  const setWeapon = (i: number, patch: Partial<{ name: string; skill: string; damage: string }>) =>
    setC({ ...c, weapons: weapons.map((w, j) => (j === i ? { ...w, ...patch } : w)) });

  const setStat = (k: CharacteristicKey, v: number) => setC({ ...c, characteristics: { ...ch, [k]: v } });
  const setSkill = (i: number, patch: Partial<{ name: string; value: number }>) =>
    setC({ ...c, skills: skills.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const rollStats = () => setC({ ...c, ...rollCharacteristics(Math.random) });
  const fillSkills = () => {
    const have = new Set(skills.map((s) => s.name));
    const add = defaultSkillValues({ characteristics: ch }).filter((s) => !have.has(s.name)).map((s) => ({ ...s, grown: false }));
    setC({ ...c, skills: [...skills, ...add] });
  };

  const valid = c.name.trim().length > 0 && Object.values(ch).every((v) => v >= 1 && v <= 99) && c.age >= 15 && c.age <= 90;

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit({
        ...c,
        name: c.name.trim(),
        skills: skills.filter((s) => s.name.trim()).map((s) => ({ ...s, name: s.name.trim() })),
        weapons: weapons.filter((w) => w.name.trim() && w.skill.trim() && w.damage.trim()).map((w) => ({ name: w.name.trim(), skill: w.skill.trim(), damage: w.damage.trim() })),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr", gap: 12 }}>
        <label>이름<input className="input" aria-label="이름" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></label>
        <label>나이<input className="input" aria-label="나이" type="number" value={c.age} onChange={(e) => setC({ ...c, age: num(e.target.value) })} /></label>
        <label>직업<input className="input" aria-label="직업" value={c.occupation ?? ""} onChange={(e) => setC({ ...c, occupation: e.target.value })} /></label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        {CHARACTERISTIC_KEYS.map((k) => (
          <label key={k}>{k}<input className="input mono" aria-label={k} type="number" value={ch[k]} onChange={(e) => setStat(k, num(e.target.value))} /></label>
        ))}
        <label>행운<input className="input mono" aria-label="행운" type="number" value={c.luck ?? 0} onChange={(e) => setC({ ...c, luck: num(e.target.value) })} /></label>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn" onClick={rollStats}>특성치 굴리기</button>
        <span style={{ color: "var(--muted)", fontSize: 12.5 }}>3d6×5 / (2d6+6)×5 로 굴려요. 나이에 따른 보정은 직접 반영해 주세요.</span>
      </div>

      <div className="mono" style={{ color: "var(--muted)" }} data-testid="derived">
        HP {derived.hp} · MP {derived.mp} · SAN {derived.san} · MOV {derived.mov} · DB {derived.damageBonus} · 체격 {derived.build}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <strong>기능</strong>
        {skills.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 8 }}>
            <input className="input" aria-label={`기능 이름 ${i + 1}`} value={s.name} onChange={(e) => setSkill(i, { name: e.target.value })} />
            <input className="input mono" style={{ width: 90 }} aria-label={`기능 값 ${i + 1}`} type="number" value={s.value} onChange={(e) => setSkill(i, { value: num(e.target.value) })} />
            <button className="btn" onClick={() => setC({ ...c, skills: skills.filter((_, j) => j !== i) })}>삭제</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setC({ ...c, skills: [...skills, { name: "", value: 20, grown: false }] })}>+ 기능 추가</button>
          <button className="btn" onClick={fillSkills}>기본 기능 채우기</button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <strong>무기</strong>
        {weapons.map((w, i) => (
          <div key={i} style={{ display: "flex", gap: 8 }}>
            <input className="input" aria-label={`무기 이름 ${i + 1}`} placeholder="이름" value={w.name} onChange={(e) => setWeapon(i, { name: e.target.value })} />
            <input className="input" aria-label={`무기 기능 ${i + 1}`} placeholder="공격 기능 (예: 사격(권총))" value={w.skill} onChange={(e) => setWeapon(i, { skill: e.target.value })} />
            <input className="input mono" style={{ width: 130 }} aria-label={`무기 피해 ${i + 1}`} placeholder="1d6+db" value={w.damage} onChange={(e) => setWeapon(i, { damage: e.target.value })} />
            <button className="btn" onClick={() => setC({ ...c, weapons: weapons.filter((_, j) => j !== i) })}>삭제</button>
          </div>
        ))}
        {weapons.length < 12 && (
          <div>
            <button className="btn" onClick={() => setC({ ...c, weapons: [...weapons, { name: "", skill: "", damage: "" }] })}>+ 무기 추가</button>
          </div>
        )}
      </div>

      <label>소지품<textarea className="input" style={{ height: 80, padding: 12 }} aria-label="소지품" value={c.possessions ?? ""} onChange={(e) => setC({ ...c, possessions: e.target.value })} /></label>
      <label>인물 배경<textarea className="input" style={{ height: 100, padding: 12 }} aria-label="인물 배경" value={c.backstory ?? ""} onChange={(e) => setC({ ...c, backstory: e.target.value })} /></label>

      <label>메모<textarea className="input" style={{ height: 80, padding: 12 }} aria-label="메모" value={c.notes ?? ""} onChange={(e) => setC({ ...c, notes: e.target.value })} /></label>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>취소</button>
        <button className="btn primary" disabled={!valid || busy} onClick={submit}>저장</button>
      </div>
    </div>
  );
}
