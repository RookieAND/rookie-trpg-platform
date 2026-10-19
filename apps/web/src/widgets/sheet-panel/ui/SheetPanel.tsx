"use client";
import { useMemo, useState } from "react";
import { StatInput } from "./StatInput";
import { VitalsPanel } from "./VitalsPanel";
import { SyncedTextarea } from "./SyncedTextarea";
import { SkillAdd, SkillValueInput, WeaponAdd } from "./GmSheetEdit";
import { stepDelta } from "../model/stat-input";
import { downloadCharacterCsv } from "@/entities/character";
import { SanPanel } from "@/features/san-check";
import { Group, Hint, useAsk } from "@/shared/ui";
import { josa, CHARACTERISTIC_KEYS, deriveCharacter, fifth, half, isSkillEdited, sheetCsvSourceFromCharacter, skillBaseValues, type Character, type HealKind, type SheetOp, type StatPath } from "@coc-vtt/shared";

export interface RollOptions {
  bonus: number;
  difficulty?: "regular" | "hard" | "extreme";
  /** GM만. 결과를 GM에게만 보인다. */
  secret?: boolean;
}

interface Props {
  characters: Character[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 세션이 진행 중이고 관전자가 아닐 때만 true */
  canAct: boolean;
  /** 굴리지 못하는 이유 한 줄(canAct가 false일 때 특성치 위에 보여 준다) */
  rollWhy?: string | null;
  /** 수치·상태·메모 편집. 판정(굴림·SAN 체크)은 canAct. GM은 세션 밖·일시정지 중에도 고칠 수 있다. 생략하면 canAct를 따른다. */
  canEdit?: boolean;
  /** 소지품·인물 배경·메모. 세션 전에도 고칠 수 있어서 canEdit와 따로 둔다. 생략하면 canEdit를 따른다. */
  canEditText?: boolean;
  onPatch: (characterId: string, ops: SheetOp[]) => void;
  onRoll: (characterId: string, name: string, opts: RollOptions) => void;
  isKp: boolean;
  onSanCheck: (characterId: string, loss: string) => void;
  onNewDay: (characterId: string) => void;
  onMadnessRoll: (characterId: string, mode: "realtime" | "summary") => void;
  onDamage: (characterId: string, weaponIndex: number) => void;
  /** GM 전용. 적은 피해를 방어구를 빼고 HP에 적용한다(중상·기절·빈사·사망은 서버가 정한다). */
  onApplyDamage?: (characterId: string, amount: number, armor: number) => void;
  /** GM 전용. 응급처치(+1), 자연 회복, 직접 회복 */
  onHeal?: (characterId: string, kind: HealKind, amount?: number) => void;
  /** 이 캐릭터를 룸에서 뺄 수 있을 때만 준다(GM은 늘, PL은 첫 세션 전) */
  onRemove?: (characterId: string) => void;
  /** GM의 NPC 시트들(PL에게는 전해지지 않는 시트). 목록과 기본 정보에 표시한다. */
  npcIds?: ReadonlySet<string>;
}

const BARS: Array<{ path: StatPath; label: string }> = [
  { path: "hp", label: "HP" },
  { path: "mp", label: "MP" },
  { path: "san", label: "SAN" },
  { path: "luck", label: "행운" },
];

/** 캐릭터 시트: 기본 정보 / 파생 수치(상태 바) / 특성치 / 무기 / 기능 / 소지품 / 비고 묶음. 묶음 제목을 눌러 접고 펼친다. */
export function SheetPanel({ characters, selectedId, onSelect, canAct, rollWhy, canEdit = canAct, canEditText = canEdit, onPatch, onRoll, isKp, onSanCheck, onNewDay, onMadnessRoll, onDamage, onApplyDamage, onHeal, onRemove, npcIds }: Props) {
  const ask = useAsk();
  const c = characters.find((x) => x.id === selectedId) ?? characters[0];
  const [bonus, setBonus] = useState(0);
  const [difficulty, setDifficulty] = useState<RollOptions["difficulty"]>(undefined);
  const [secret, setSecret] = useState(false);
  const [filter, setFilter] = useState("");
  const [editedOnly, setEditedOnly] = useState(false);
  const characteristics = c?.characteristics;
  const base = useMemo(() => (characteristics ? skillBaseValues({ characteristics }) : null), [characteristics]);
  if (!c || !base) return null;
  const roll = (id: string, name: string, o: RollOptions) => {
    onRoll(id, name, o);
    if (secret) setSecret(false);
  };

  const d = deriveCharacter(c);
  const opts: RollOptions = { bonus, ...(difficulty ? { difficulty } : {}), ...(isKp && secret ? { secret: true } : {}) };
  const all = Object.entries(c.skills);
  const skills = all
    .filter(([name]) => name.includes(filter.trim()))
    .filter(([name, s]) => !editedOnly || isSkillEdited(base, name, s))
    .sort(([a], [b]) => a.localeCompare(b, "ko"));
  const editedCount = all.filter(([name, s]) => isSkillEdited(base, name, s)).length;
  const filtering = filter.trim() !== "" || editedOnly;

  return (
    <div className="sheet" data-testid="sheet">
      {ask.node}
      <Group title="기본 정보" testId="sheet-basic">
        <div className="sheet-head">
          {characters.length > 1 ? (
            <select className="input" aria-label="캐릭터 선택" value={c.id} onChange={(e) => onSelect(e.target.value)}>
              {npcIds && npcIds.size > 0 && characters.some((x) => !npcIds.has(x.id)) ? (
                <>
                  <optgroup label="PL 시트">{characters.filter((x) => !npcIds.has(x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                  <optgroup label="NPC 시트 (PL에게 안 보여요)">{characters.filter((x) => npcIds.has(x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                </>
              ) : (
                characters.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)
              )}
            </select>
          ) : (
            <strong style={{ fontSize: 15 }}>{c.name}</strong>
          )}
          <span className="sheet-sub">{c.occupation || "직업 없음"} · {c.age}세 · MOV {d.mov} · DB {d.damageBonus} · 체격 {d.build}</span>
          {npcIds?.has(c.id) && <span className="sheet-sub" data-testid="npc-badge">NPC 시트 · PL에게는 보이지 않아요</span>}
        </div>
      </Group>

      <Group title="파생 수치" testId="sheet-derived">
        <div className="sheet-sec">
          {BARS.map(({ path, label }) => {
            const max = d.limits[path];
            const cur = c[path];
            return (
              <div key={path} className="bar-row">
                <span className="bar-label">{label}{path === "san" && <Hint term="san" />}{path === "luck" && <Hint term="luck" />}</span>
                <div style={{ height: 8, borderRadius: 4, background: "var(--panel-2)", overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, (cur / max) * 100)}%`, height: "100%", background: path === "hp" ? "var(--danger)" : "var(--accent)" }} />
                </div>
                <span className="bar-ctl">
                  <button className="btn ico" aria-label={`${label} 5 감소`} disabled={!canEdit || stepDelta(-5, cur, max) === null} onClick={() => onPatch(c.id, [{ path, delta: stepDelta(-5, cur, max) ?? 0 }])}>−5</button>
                  <button className="btn ico" aria-label={`${label} 감소`} disabled={!canEdit} onClick={() => onPatch(c.id, [{ path, delta: -1 }])}>−</button>
                  <span className="mono bar-val" data-testid={`stat-${path}`}>{cur}/{max}</span>
                  <button className="btn ico" aria-label={`${label} 증가`} disabled={!canEdit} onClick={() => onPatch(c.id, [{ path, delta: 1 }])}>+</button>
                  <button className="btn ico" aria-label={`${label} 5 증가`} disabled={!canEdit || stepDelta(5, cur, max) === null} onClick={() => onPatch(c.id, [{ path, delta: stepDelta(5, cur, max) ?? 0 }])}>+5</button>
                </span>
                <StatInput label={label} current={cur} max={max} disabled={!canEdit} onApply={(edit) => onPatch(c.id, [{ path, ...edit }])} />
              </div>
            );
          })}
        </div>

        <VitalsPanel
          c={c}
          maxHp={d.limits.hp}
          isKp={isKp}
          canEdit={canEdit}
          canAct={canAct}
          onPatch={onPatch}
          onConRoll={() => roll(c.id, "CON", { bonus: 0, ...(isKp && secret ? { secret: true } : {}) })}
          {...(onApplyDamage ? { onApplyDamage } : {})}
          {...(onHeal ? { onHeal } : {})}
        />

        <SanPanel
          character={c}
          canAct={canAct}
          isKp={isKp}
          onCheck={(loss) => onSanCheck(c.id, loss)}
          onSetMadness={(value) => onPatch(c.id, [{ path: "madness", value }])}
          onNewDay={() => onNewDay(c.id)}
          onMadnessRoll={(mode) => onMadnessRoll(c.id, mode)}
        />
      </Group>

      <Group title="특성치" testId="sheet-stats">
        <div className="sheet-sec">
          <div className="row">
            <select className="input" style={{ flex: 1, minWidth: 0 }} aria-label="보너스·페널티" value={bonus} onChange={(e) => setBonus(Number(e.target.value))}>
              <option value={2}>보너스 2</option>
              <option value={1}>보너스 1</option>
              <option value={0}>기본</option>
              <option value={-1}>페널티 1</option>
              <option value={-2}>페널티 2</option>
            </select>
            <Hint term="bonus" label="보너스·페널티 설명" />
            <select className="input" style={{ flex: 1, minWidth: 0 }} aria-label="난이도" value={difficulty ?? ""} onChange={(e) => setDifficulty((e.target.value || undefined) as RollOptions["difficulty"])}>
              <option value="">난이도 없음</option>
              <option value="regular">보통</option>
              <option value="hard">어려움</option>
              <option value="extreme">극단적</option>
            </select>
            <Hint term="difficulty" label="난이도 설명" />
          </div>
          {isKp && (
            <label className="check" title="결과는 GM에게만 보여요. 한 번만 적용돼요.">
              <input type="checkbox" aria-label="비밀 판정" checked={secret} onChange={(e) => setSecret(e.target.checked)} style={{ accentColor: "#7c86f7" }} />
              비밀 판정
            </label>
          )}
          {!canAct && rollWhy && <div className="why" data-testid="sheet-roll-why">{rollWhy}</div>}
          <div className="stat-grid">
            {CHARACTERISTIC_KEYS.map((k) => (
              <button key={k} className="btn stat-btn" disabled={!canAct} onClick={() => roll(c.id, k, opts)} aria-label={`${k} 굴리기`}>
                <span className="stat-key">{k}</span>
                <span className="mono">{c.characteristics[k]}</span>
              </button>
            ))}
          </div>
        </div>
      </Group>

      {((c.weapons?.length ?? 0) > 0 || (isKp && canEditText)) && (
        <Group title="무기" meta={c.weapons?.length ?? 0} testId="weapons">
          {(c.weapons ?? []).map((w, i) => (
            <div key={i} className="line" data-testid={`weapon-${w.name}`}>
              <span>
                {w.name} <span className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>{w.skill} · {w.damage}</span>
              </span>
              <button className="btn sm" disabled={!canAct} onClick={() => roll(c.id, w.skill, opts)} aria-label={`${w.name} 공격`}>공격</button>
              <button className="btn sm" disabled={!canAct} onClick={() => onDamage(c.id, i)} aria-label={`${w.name} 피해`}>피해</button>
              {isKp && <button className="btn sm danger" disabled={!canEditText} aria-label={`${w.name} 빼기`} onClick={() => onPatch(c.id, [{ path: "weapons", value: (c.weapons ?? []).filter((_, j) => j !== i) }])}>빼기</button>}
            </div>
          ))}
          {isKp && <WeaponAdd skills={all.map(([n]) => n).sort((a, b) => a.localeCompare(b, "ko"))} count={c.weapons?.length ?? 0} disabled={!canEditText} onAdd={(w) => onPatch(c.id, [{ path: "weapons", value: [...(c.weapons ?? []), w] }])} />}
        </Group>
      )}

      <Group title="기능" meta={filtering ? `${skills.length}/${all.length}` : skills.length} testId="sheet-skills">
        <div className="sheet-sec">
          <input className="input" aria-label="기능 찾기" placeholder="기능 찾기" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={editedOnly} onChange={(e) => setEditedOnly(e.target.checked)} style={{ accentColor: "#7c86f7" }} />
            수정한 기능만 보기 <span className="count">{editedCount}</span>
          </label>
          <div className="res-sub" style={{ display: "flex", alignItems: "center", gap: 6 }} data-testid="grown-legend">
            <span aria-hidden>☑</span> 체크한 기능은 세션이 끝나면 성장 굴림을 해요
            <Hint term="grown" />
          </div>
        </div>
        <div className="sheet-sec">
          {skills.map(([name, s]) => (
            <div key={name} data-testid={`skill-${name}`} className="line skill-row">
              <input type="checkbox" title="이번 세션에서 성공했어요 (행운으로 성공한 건 제외). 세션 끝에 성장 굴림을 해요." aria-label={`${name} 성장 표시`} checked={s.grown} disabled={!canEdit} onChange={(e) => onPatch(c.id, [{ path: "skill", name, grown: e.target.checked }])} style={{ accentColor: "#7c86f7" }} />
              <span>{name}</span>
              {isKp ? (
                <span className="mono" style={{ color: "var(--muted)" }}>
                  <SkillValueInput key={`${c.id}-${name}-${s.value}`} name={name} value={s.value} disabled={!canEdit} onCommit={(value) => onPatch(c.id, [{ path: "skill", name, value }])} /> <span style={{ fontSize: 12 }}>({half(s.value)}/{fifth(s.value)})</span>
                </span>
              ) : (
                <span className="mono" style={{ color: "var(--muted)" }}>{s.value} <span style={{ fontSize: 12 }}>({half(s.value)}/{fifth(s.value)})</span></span>
              )}
              <button className="btn sm" disabled={!canAct} onClick={() => roll(c.id, name, opts)} aria-label={`${name} 굴리기`}>굴리기</button>
            </div>
          ))}
          {skills.length === 0 && <div style={{ color: "var(--muted)" }}>일치하는 기능이 없어요.</div>}
          {isKp && <SkillAdd disabled={!canEdit} onAdd={(name, value) => onPatch(c.id, [{ path: "skill", name, value }])} />}
        </div>
      </Group>

      <Group title="소지품" defaultOpen={canEditText || (c.possessions ?? "") !== ""} testId="sheet-possessions">
        <SyncedTextarea
          key={`pos-${c.id}`}
          className="input"
          style={{ height: 64 }}
          aria-label="소지품"
          value={c.possessions ?? ""}
          disabled={!canEditText}
          onCommit={(value) => onPatch(c.id, [{ path: "possessions", value }])}
        />
      </Group>

      <Group title="비고" defaultOpen={canEditText || (c.backstory ?? "") !== "" || c.notes !== ""} testId="sheet-notes">
        <label className="sheet-sec">
          <span className="section-title">인물 배경</span>
          <SyncedTextarea
            key={`bg-${c.id}`}
            aria-label="인물 배경"
            className="input"
            style={{ height: 72 }}
            value={c.backstory ?? ""}
            disabled={!canEditText}
            onCommit={(value) => onPatch(c.id, [{ path: "backstory", value }])}
          />
        </label>
        <label className="sheet-sec">
          <span className="section-title">메모</span>
          <SyncedTextarea
            key={`notes-${c.id}`}
            aria-label="메모"
            className="input"
            style={{ height: 72 }}
            value={c.notes}
            disabled={!canEditText}
            onCommit={(value) => onPatch(c.id, [{ path: "notes", value }])}
          />
        </label>
      </Group>

      <div className="row sheet-actions">
        <button type="button" className="btn" onClick={() => downloadCharacterCsv(sheetCsvSourceFromCharacter(c))}>CSV로 내보내기</button>
        {onRemove && (
          <button
            className="btn danger"
            onClick={async () => (await ask.confirm({ title: `${josa(`'${c.name}'`, "을/를")} 이 룸에서 뺄까요?`, message: `시트 내용이 사라져요.${isKp ? "" : " 보관함의 원본은 그대로예요."}`, confirmLabel: "빼기", danger: true })) && onRemove(c.id)}
          >
            이 캐릭터 빼기
          </button>
        )}
      </div>
    </div>
  );
}

/** 시트 탭이 비었을 때(룸에 캐릭터가 없을 때) 다음 행동을 알려 준다. */
export function SheetEmpty({ role, canLoad }: { role: "kp" | "pl" | "spectator"; canLoad: boolean }) {
  const text =
    role === "spectator"
      ? "관전자는 시트를 볼 수 없어요."
      : role === "kp"
        ? "아직 룸에 캐릭터가 없어요. NPC를 만들거나, 아래에서 보관함 캐릭터를 불러오거나, PL이 만들길 기다려요."
        : canLoad
          ? "내 캐릭터가 아직 없어요. ‘캐릭터 만들기’로 바로 만들거나, 아래에서 보관함 캐릭터를 불러와요."
          : "아직 내 캐릭터가 없어요.";
  return <div className="sheet-empty-note" data-testid="sheet-empty">{text}</div>;
}
