"use client";
import { useMemo, useState } from "react";
import { CHARACTERISTIC_KEYS, LIMITS, defaultSkillValues, deriveCharacter, isSkillEdited, rollCharacteristics, skillBaseValues, type CharacterInput, type CharacteristicKey } from "@coc-vtt/shared";
import { SheetCsvImport, downloadCharacterCsv } from "@/entities/character";
import type { Caller } from "@/shared/api";
import { Group, LimitNote } from "@/shared/ui";

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

/**
 * 보관함 캐릭터를 만들거나 고치는 폼. 생성 마법사는 따로 붙는다.
 * me를 주면 CSV 가져오기·내보내기·양식 받기가 위에 붙는다(가져오면 폼 내용이 바뀌고, 저장은 따로 눌러야 한다).
 */
export function CharacterForm({ initial, onSubmit, onCancel, me }: { initial?: CharacterInput; onSubmit: (data: CharacterInput) => Promise<void> | void; onCancel: () => void; me?: Caller }) {
  const [c, setC] = useState<CharacterInput>(initial ?? DEFAULT);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [editedOnly, setEditedOnly] = useState(false);
  const [imported, setImported] = useState(false);
  const ch = c.characteristics;
  const derived = deriveCharacter({ characteristics: ch, age: c.age });
  const skills = c.skills ?? [];
  const weapons = c.weapons ?? [];
  const base = useMemo(() => skillBaseValues({ characteristics: ch }), [ch]);
  const setWeapon = (i: number, patch: Partial<{ name: string; skill: string; damage: string }>) =>
    setC({ ...c, weapons: weapons.map((w, j) => (j === i ? { ...w, ...patch } : w)) });

  const setStat = (k: CharacteristicKey, v: number) => setC({ ...c, characteristics: { ...ch, [k]: v } });
  const setSkill = (i: number, patch: Partial<{ name: string; value: number; grown: boolean }>) =>
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

  // 찾기와 '수정한 기능만 보기'. 번호(aria-label)는 전체 목록 기준이라 걸러도 바뀌지 않는다.
  const q = filter.trim();
  const visible = skills
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => (q === "" || s.name.includes(q)) && (!editedOnly || isSkillEdited(base, s.name.trim(), { value: s.value, grown: s.grown })));
  const editedCount = skills.filter((s) => isSkillEdited(base, s.name.trim(), { value: s.value, grown: s.grown })).length;

  return (
    <div className="card cf" data-testid="character-form">
      {me && (
        <div className="cf-tools">
          <SheetCsvImport
            me={me}
            applyLabel="폼에 적용"
            onApply={(d) => {
              setC({ ...d });
              setImported(true);
            }}
          >
            <button type="button" className="btn" onClick={() => downloadCharacterCsv({ ...c, name: c.name, skills, weapons })}>CSV로 내보내기</button>
          </SheetCsvImport>
        </div>
      )}
      {imported && <div className="res-sub cf-imported" role="status" data-testid="csv-applied">CSV 내용을 폼에 넣었어요. 확인한 뒤 저장을 눌러야 반영돼요.</div>}

      <Group title="기본 정보" testId="cf-basic">
        <div className="cf-basic">
          <label className="field">이름<input className="input" aria-label="이름" value={c.name} maxLength={LIMITS.characterName} onChange={(e) => setC({ ...c, name: e.target.value })} /><LimitNote label="이름" max={LIMITS.characterName} value={c.name} /></label>
          <label className="field">나이<input className="input" aria-label="나이" type="number" value={c.age} onChange={(e) => setC({ ...c, age: num(e.target.value) })} /></label>
          <label className="field">직업<input className="input" aria-label="직업" value={c.occupation ?? ""} maxLength={LIMITS.occupation} onChange={(e) => setC({ ...c, occupation: e.target.value })} /></label>
        </div>
      </Group>

      <Group
        title="특성치"
        testId="cf-stats"
        actions={<button type="button" className="btn sm" onClick={rollStats}>특성치 굴리기</button>}
      >
        <div className="cf-stats">
          {CHARACTERISTIC_KEYS.map((k) => (
            <label key={k} className="field">{k}<input className="input mono" aria-label={k} type="number" value={ch[k]} onChange={(e) => setStat(k, num(e.target.value))} /></label>
          ))}
        </div>
        <div className="res-sub">3d6×5 / (2d6+6)×5 로 굴려요. 나이에 따른 보정은 직접 반영해 주세요.</div>
      </Group>

      <Group title="파생 수치" testId="cf-derived">
        <div className="cf-derived">
          <label className="field">행운<input className="input mono" aria-label="행운" type="number" value={c.luck ?? 0} onChange={(e) => setC({ ...c, luck: num(e.target.value) })} /></label>
          <div className="mono cf-derived-line" data-testid="derived">
            HP {derived.hp} · MP {derived.mp} · SAN {derived.san} · MOV {derived.mov} · DB {derived.damageBonus} · 체격 {derived.build}
          </div>
        </div>
      </Group>

      <Group
        title="기능"
        meta={q !== "" || editedOnly ? `${visible.length}/${skills.length}` : skills.length}
        testId="cf-skills"
        actions={
          <>
            <button type="button" className="btn sm" onClick={() => setC({ ...c, skills: [...skills, { name: "", value: 20, grown: false }] })}>+ 기능 추가</button>
            <button type="button" className="btn sm" onClick={fillSkills}>기본 기능 채우기</button>
          </>
        }
      >
        {skills.length > 0 && (
          <div className="cf-filter">
            <input className="input" aria-label="기능 찾기" placeholder="기능 찾기" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <label className="check">
              <input type="checkbox" checked={editedOnly} onChange={(e) => setEditedOnly(e.target.checked)} style={{ accentColor: "#7c86f7" }} />
              수정한 기능만 보기 <span className="count">{editedCount}</span>
            </label>
          </div>
        )}
        {skills.length === 0 && <div className="res-sub">아직 기능이 없어요. ‘기본 기능 채우기’로 7판 기본 기능을 넣을 수 있어요.</div>}
        <div className="cf-skills">
          {visible.map(({ s, i }) => (
            <div key={i} className="cf-skill">
              <input className="input" aria-label={`기능 이름 ${i + 1}`} value={s.name} maxLength={LIMITS.skillName} onChange={(e) => setSkill(i, { name: e.target.value })} />
              <input className="input mono" aria-label={`기능 값 ${i + 1}`} type="number" value={s.value} onChange={(e) => setSkill(i, { value: num(e.target.value) })} />
              <input type="checkbox" title="성장 표시" aria-label={`기능 성장 ${i + 1}`} checked={s.grown ?? false} onChange={(e) => setSkill(i, { grown: e.target.checked })} style={{ accentColor: "#7c86f7" }} />
              <button type="button" className="btn ghost sm" aria-label={`기능 ${i + 1} 지우기`} onClick={() => setC({ ...c, skills: skills.filter((_, j) => j !== i) })}>삭제</button>
            </div>
          ))}
        </div>
        {skills.length > 0 && visible.length === 0 && <div className="res-sub">조건에 맞는 기능이 없어요.</div>}
      </Group>

      <Group
        title="무기"
        meta={weapons.length}
        testId="cf-weapons"
        actions={weapons.length < 12 ? <button type="button" className="btn sm" onClick={() => setC({ ...c, weapons: [...weapons, { name: "", skill: "", damage: "" }] })}>+ 무기 추가</button> : undefined}
      >
        {weapons.length === 0 && <div className="res-sub">공격 기능과 피해 식(예: 1d6+db)을 적어 두면 시트에서 바로 굴려요.</div>}
        {weapons.map((w, i) => (
          <div key={i} className="cf-weapon">
            <input className="input" aria-label={`무기 이름 ${i + 1}`} placeholder="이름" value={w.name} maxLength={LIMITS.weaponName} onChange={(e) => setWeapon(i, { name: e.target.value })} />
            <input className="input" aria-label={`무기 기능 ${i + 1}`} placeholder="공격 기능 (예: 사격(권총))" value={w.skill} maxLength={LIMITS.weaponName} onChange={(e) => setWeapon(i, { skill: e.target.value })} />
            <input className="input mono" aria-label={`무기 피해 ${i + 1}`} placeholder="1d6+db" value={w.damage} maxLength={LIMITS.weaponDamage} onChange={(e) => setWeapon(i, { damage: e.target.value })} />
            <button type="button" className="btn ghost sm" aria-label={`무기 ${i + 1} 지우기`} onClick={() => setC({ ...c, weapons: weapons.filter((_, j) => j !== i) })}>삭제</button>
          </div>
        ))}
      </Group>

      <Group title="소지품" testId="cf-possessions">
        <textarea className="input" style={{ height: 80 }} aria-label="소지품" value={c.possessions ?? ""} maxLength={LIMITS.possessions} onChange={(e) => setC({ ...c, possessions: e.target.value })} />
      </Group>

      <Group title="비고" testId="cf-notes">
        <label className="field">인물 배경<textarea className="input" style={{ height: 100 }} aria-label="인물 배경" value={c.backstory ?? ""} maxLength={LIMITS.backstory} onChange={(e) => setC({ ...c, backstory: e.target.value })} /><LimitNote label="인물 배경" max={LIMITS.backstory} value={c.backstory ?? ""} /></label>
        <label className="field">메모<textarea className="input" style={{ height: 80 }} aria-label="메모" value={c.notes ?? ""} maxLength={LIMITS.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} /><LimitNote label="메모" max={LIMITS.notes} value={c.notes ?? ""} /></label>
      </Group>

      <div className="cf-foot">
        <button className="btn" onClick={onCancel}>취소</button>
        <button className="btn primary" disabled={!valid || busy} onClick={submit}>저장</button>
      </div>
    </div>
  );
}
