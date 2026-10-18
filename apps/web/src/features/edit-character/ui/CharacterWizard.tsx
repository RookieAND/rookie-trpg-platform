"use client";
import { useMemo, useState } from "react";
import {
  CHARACTERISTIC_KEYS,
  FIXED_SKILLS,
  OCCUPATION_POINT_FORMULAS,
  SKILL_CREATION_CAP,
  ageRules,
  applyAge,
  buildCharacterInput,
  checkAgeAdjustment,
  checkAllocation,
  creationSkills,
  deriveCharacter,
  eduImprovement,
  rollCharacteristics,
  rollLuckFor,
  type CharacterInput,
  type Occupation,
  type CharacteristicKey,
  type OccupationFormulaId,
  type SkillAllocation,
} from "@coc-vtt/shared";

import { nextBlockReason } from "../model/next-reason";

const STEPS = ["기본 정보", "특성치", "기능", "확인"] as const;
const num = (v: string) => (v === "" ? 0 : Math.max(0, Math.floor(Number(v)) || 0));
const FLAT: Record<CharacteristicKey, number> = { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 };

/** 7판 규칙대로 한 단계씩 캐릭터를 만든다: 기본 정보 → 특성치(나이 보정) → 기능 포인트 → 확인. */
export function CharacterWizard({ occupations, onSubmit, onCancel }: { occupations: Occupation[]; onSubmit: (data: CharacterInput) => Promise<void> | void; onCancel: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [age, setAge] = useState(25);
  const [occupation, setOccupation] = useState("");
  const [base, setBase] = useState<Record<CharacteristicKey, number>>(FLAT);
  const [luck, setLuck] = useState(50);
  const [cut, setCut] = useState<Partial<Record<CharacteristicKey, number>>>({});
  const [edu, setEdu] = useState<{ gain: number; steps: Array<{ roll: number; gain: number }> } | null>(null);
  const [formula, setFormula] = useState<OccupationFormulaId>("edu4");
  const [job, setJob] = useState<Occupation | null>(null);
  const [alloc, setAlloc] = useState<SkillAllocation>({});
  const [backstory, setBackstory] = useState("");
  const [possessions, setPossessions] = useState("");
  const [busy, setBusy] = useState(false);
  const [skillFilter, setSkillFilter] = useState("");

  const rules = useMemo(() => ageRules(age), [age]);
  const ageOk = age >= 15 && age <= 90;
  const cutError = checkAgeAdjustment(rules, cut);
  const eduPending = rules.eduChecks > 0 && !edu;
  const final = useMemo(() => applyAge(base, rules, cut, edu?.gain ?? 0), [base, rules, cut, edu]);
  const baseOk = CHARACTERISTIC_KEYS.every((k) => base[k] >= 1 && base[k] <= 99);
  const derived = deriveCharacter({ characteristics: final, age });
  const check = useMemo(() => checkAllocation(final, job?.formula ?? formula, alloc, job ?? undefined), [final, formula, alloc, job]);
  const skills = useMemo(() => creationSkills(final), [final]);

  const resetAgeParts = () => {
    setCut({});
    setEdu(null);
  };
  const roll = () => {
    const r = rollCharacteristics(Math.random);
    setBase(r.characteristics);
    setLuck(rollLuckFor(age, Math.random));
    resetAgeParts();
  };
  const rollEdu = () => {
    const r = eduImprovement(Math.max(1, base.EDU - rules.eduPenalty), rules.eduChecks, Math.random);
    setEdu({ gain: r.edu - Math.max(1, base.EDU - rules.eduPenalty), steps: r.steps });
  };
  const setPts = (n: string, kind: "occ" | "personal", v: number) =>
    setAlloc((a) => ({ ...a, [n]: { occ: a[n]?.occ ?? 0, personal: a[n]?.personal ?? 0, [kind]: v } }));

  const nextWhy = nextBlockReason({ step, name, ageOk, baseOk, cutError, eduPending, pointErrors: check.errors });
  const canNext = nextWhy === null;

  const create = async () => {
    setBusy(true);
    try {
      await onSubmit(buildCharacterInput({ name, age, occupation, characteristics: final, luck, alloc, backstory, possessions }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ gap: 16 }} data-testid="wizard">
      <ol style={{ display: "flex", gap: 8, margin: 0, padding: 0, listStyle: "none", flexWrap: "wrap" }} aria-label="진행 단계">
        {STEPS.map((s, i) => (
          <li key={s} className="badge" aria-current={i === step ? "step" : undefined} style={{ opacity: i === step ? 1 : 0.55 }}>{i + 1}. {s}</li>
        ))}
      </ol>

      {step === 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr", gap: 12 }}>
          <label>이름<input className="input" aria-label="이름" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>나이<input className="input" aria-label="나이" type="number" value={age} onChange={(e) => { setAge(Number(e.target.value)); resetAgeParts(); }} /></label>
          <label>직업<input className="input" aria-label="직업" value={occupation} maxLength={40} onChange={(e) => { setOccupation(e.target.value); setJob(null); }} /></label>
          {occupations.length > 0 && (
            <label style={{ gridColumn: "1 / -1" }}>정의해 둔 직업 불러오기
              <select className="input" aria-label="정의해 둔 직업" value={job?.id ?? ""} onChange={(e) => {
                const o = occupations.find((x) => x.id === e.target.value) ?? null;
                setJob(o);
                if (o) {
                  setOccupation(o.name);
                  setFormula(o.formula);
                }
              }}>
                <option value="">직접 적기 (기능 제한 없음)</option>
                {occupations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
          )}
          {!ageOk && <div className="err" role="alert" style={{ gridColumn: "1 / -1" }}>나이는 15~90세예요.</div>}
        </div>
      )}

      {step === 1 && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn" onClick={roll}>특성치 굴리기</button>
            <span style={{ color: "var(--muted)", fontSize: 12.5 }}>3d6×5 / (2d6+6)×5. 직접 적어도 돼요(합계 {CHARACTERISTIC_KEYS.reduce((s, k) => s + base[k], 0)}, 포인트 구입은 460).</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            {CHARACTERISTIC_KEYS.map((k) => (
              <label key={k}>{k}<input className="input mono" aria-label={`${k} 기본값`} type="number" value={base[k]} onChange={(e) => { setBase({ ...base, [k]: Number(e.target.value) }); setEdu(null); }} /></label>
            ))}
            <label>행운<input className="input mono" aria-label="행운" type="number" value={luck} onChange={(e) => setLuck(Number(e.target.value))} /></label>
          </div>

          {(rules.physicalPenalty > 0 || rules.appPenalty > 0 || rules.eduPenalty > 0 || rules.eduChecks > 0) && (
            <div className="card" style={{ gap: 8 }} data-testid="age-rules">
              <strong>{age}세 나이 보정</strong>
              {rules.physicalPenalty > 0 && (
                <>
                  <div>{rules.physicalKeys.join("·")}에서 합계 {rules.physicalPenalty}만큼 깎아요.</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {rules.physicalKeys.map((k) => (
                      <label key={k} style={{ display: "grid", gap: 2 }}>{k} −<input className="input mono" style={{ width: 80 }} aria-label={`${k} 깎기`} type="number" min={0} value={cut[k] ?? 0} onChange={(e) => setCut({ ...cut, [k]: num(e.target.value) })} /></label>
                    ))}
                  </div>
                  {cutError && <div className="err" role="alert">{cutError}</div>}
                </>
              )}
              {rules.appPenalty > 0 && <div>APP −{rules.appPenalty} (자동 적용)</div>}
              {rules.eduPenalty > 0 && <div>EDU −{rules.eduPenalty} (자동 적용)</div>}
              {rules.luckTwice && <div style={{ color: "var(--muted)" }}>행운은 두 번 굴려 높은 쪽을 써요. (굴리기에 반영돼요)</div>}
              {rules.eduChecks > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  <div>교육 향상 판정 {rules.eduChecks}회: d100이 EDU보다 크면 EDU가 1d10 올라요.</div>
                  <div>
                    <button className="btn" onClick={rollEdu} disabled={!!edu}>교육 향상 판정</button>
                  </div>
                  {edu && (
                    <div className="mono" data-testid="edu-result">
                      {edu.steps.map((s, i) => `${i + 1}회 ${s.roll}${s.gain ? ` → +${s.gain}` : " → 변화 없음"}`).join(" · ")} (EDU +{edu.gain})
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mono" style={{ color: "var(--muted)" }} data-testid="final-stats">
            {CHARACTERISTIC_KEYS.map((k) => `${k} ${final[k]}`).join(" · ")} · 행운 {luck}
          </div>
          <div className="mono" style={{ color: "var(--muted)" }}>HP {derived.hp} · MP {derived.mp} · SAN {derived.san} · MOV {derived.mov} · DB {derived.damageBonus} · 체격 {derived.build}</div>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ gap: 4, fontSize: 12.5, color: "var(--muted)" }} data-testid="points-guide">
            <span><strong>직업 포인트</strong>는 직업이 요구하는 기능(★)과 신용도에, <strong>관심 포인트</strong>는 아무 기능에나 쓰는 몫이에요.</span>
            <span>기능 칸에 숫자를 적으면 그 만큼 올라가요. 남는 포인트는 그대로 둬도 돼요. {job ? "" : "직업을 정해 두지 않았다면 직업 포인트는 어느 기능에나 쓸 수 있어요."}</span>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            직업 포인트 공식
            <select className="input" aria-label="직업 포인트 공식" disabled={!!job} value={job?.formula ?? formula} onChange={(e) => setFormula(e.target.value as OccupationFormulaId)}>
              {OCCUPATION_POINT_FORMULAS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </label>
          {job && <div style={{ color: "var(--muted)", fontSize: 12.5 }}>'{job.name}': 직업 포인트는 ★ 표시한 기능과 신용도에만 쓸 수 있고, 신용도는 {job.creditMin}~{job.creditMax}이어야 해요.</div>}
          <div className="mono" data-testid="points-left">
            직업 {check.occPool - check.occUsed} / {check.occPool} 남음 · 관심 {check.personalPool - check.personalUsed} / {check.personalPool} 남음
          </div>
          {check.errors.map((e) => (
            <div key={e} className="err" role="alert">{e}</div>
          ))}
          <input className="input" aria-label="기능 찾기" placeholder="기능 찾기 (예: 사격, 외국어)" value={skillFilter} onChange={(e) => setSkillFilter(e.target.value)} />
          <div style={{ display: "grid", gap: 6, maxHeight: "min(480px, 55vh)", overflow: "auto" }}>
            {skills.filter((s) => s.name.includes(skillFilter.trim()) || (alloc[s.name]?.occ ?? 0) + (alloc[s.name]?.personal ?? 0) > 0).map((s) => {
              const a = alloc[s.name] ?? { occ: 0, personal: 0 };
              const fixed = (FIXED_SKILLS as readonly string[]).includes(s.name);
              const star = !!job && (job.skills.includes(s.name) || s.name === "신용도");
              return (
                <div key={s.name} data-invalid={check.errors.some((e) => e.startsWith(`${s.name}:`))} style={{ display: "grid", gridTemplateColumns: "1fr 50px 80px 80px 50px", gap: 8, alignItems: "center", ...(check.errors.some((e) => e.startsWith(`${s.name}:`)) ? { outline: "1px solid var(--danger)", borderRadius: 6, padding: 2 } : {}) }}>
                  <span>{star && "★ "}{s.name}</span>
                  <span className="mono" style={{ color: "var(--muted)" }}>{s.value}</span>
                  <input className="input mono" disabled={fixed || (!!job && !star)} aria-label={`${s.name} 직업 포인트`} type="number" min={0} value={a.occ || ""} placeholder="직업" onChange={(e) => setPts(s.name, "occ", num(e.target.value))} />
                  <input className="input mono" disabled={fixed} aria-label={`${s.name} 관심 포인트`} type="number" min={0} value={a.personal || ""} placeholder="관심" onChange={(e) => setPts(s.name, "personal", num(e.target.value))} />
                  <span className="mono">{s.value + a.occ + a.personal}</span>
                </div>
              );
            })}
          </div>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>한 기능은 생성 때 {SKILL_CREATION_CAP}까지 올릴 수 있어요. 남는 포인트는 그대로 둬도 돼요.</span>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "grid", gap: 12 }}>
          <div data-testid="review">
            <strong>{name.trim()}</strong> · {age}세 · {occupation.trim() || "직업 없음"}
          </div>
          <div className="mono" style={{ color: "var(--muted)" }}>{CHARACTERISTIC_KEYS.map((k) => `${k} ${final[k]}`).join(" · ")} · 행운 {luck}</div>
          <div className="mono" style={{ color: "var(--muted)" }}>HP {derived.hp} · MP {derived.mp} · SAN {derived.san} · MOV {derived.mov} · DB {derived.damageBonus} · 체격 {derived.build}</div>
          <label>소지품<textarea className="input" style={{ height: 72, padding: 12 }} aria-label="소지품" value={possessions} onChange={(e) => setPossessions(e.target.value)} /></label>
          <label>인물 배경<textarea className="input" style={{ height: 90, padding: 12 }} aria-label="인물 배경" value={backstory} onChange={(e) => setBackstory(e.target.value)} /></label>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>무기와 기능 세부는 만든 뒤 편집에서 고칠 수 있어요.</span>
        </div>
      )}

      {nextWhy && step < STEPS.length - 1 && <div className="why" id="wizard-next-why" data-testid="wizard-next-why" style={{ textAlign: "right" }}>{nextWhy}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>취소</button>
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>이전</button>}
        {step < STEPS.length - 1 ? (
          <button className="btn primary" disabled={!canNext} aria-describedby={nextWhy ? "wizard-next-why" : undefined} onClick={() => setStep(step + 1)}>다음</button>
        ) : (
          <button className="btn primary" disabled={busy} onClick={create}>캐릭터 만들기</button>
        )}
      </div>
    </div>
  );
}
