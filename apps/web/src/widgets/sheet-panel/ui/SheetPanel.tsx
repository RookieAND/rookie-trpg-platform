"use client";
import { useState } from "react";
import { SanPanel } from "@/features/san-check";
import { Hint } from "@/shared/ui";
import { CHARACTERISTIC_KEYS, CONDITIONS, CONDITION_LABEL_KO, deriveCharacter, fifth, half, type Character, type SheetOp, type StatPath } from "@coc-vtt/shared";

export interface RollOptions {
  bonus: number;
  difficulty?: "regular" | "hard" | "extreme";
  /** KP만. 결과를 KP에게만 보인다. */
  secret?: boolean;
}

interface Props {
  characters: Character[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 세션이 진행 중이고 관전자가 아닐 때만 true */
  canAct: boolean;
  /** 수치·상태·메모 편집. 판정(굴림·SAN 체크)은 canAct. KP는 세션 밖·일시정지 중에도 고칠 수 있다. 생략하면 canAct를 따른다. */
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
  /** 이 캐릭터를 룸에서 뺄 수 있을 때만 준다(KP는 늘, PL은 첫 세션 전) */
  onRemove?: (characterId: string) => void;
}

const BARS: Array<{ path: StatPath; label: string }> = [
  { path: "hp", label: "HP" },
  { path: "mp", label: "MP" },
  { path: "san", label: "SAN" },
  { path: "luck", label: "행운" },
];

/** 캐릭터 시트: 상태 바(±), 특성치·기능 굴리기, 성장 표시, 메모. */
export function SheetPanel({ characters, selectedId, onSelect, canAct, canEdit = canAct, canEditText = canEdit, onPatch, onRoll, isKp, onSanCheck, onNewDay, onMadnessRoll, onDamage, onRemove }: Props) {
  const c = characters.find((x) => x.id === selectedId) ?? characters[0];
  const [bonus, setBonus] = useState(0);
  const [difficulty, setDifficulty] = useState<RollOptions["difficulty"]>(undefined);
  const [secret, setSecret] = useState(false);
  const [filter, setFilter] = useState("");
  if (!c) return null;
  const roll = (id: string, name: string, o: RollOptions) => {
    onRoll(id, name, o);
    if (secret) setSecret(false);
  };

  const d = deriveCharacter(c);
  const opts: RollOptions = { bonus, ...(difficulty ? { difficulty } : {}), ...(isKp && secret ? { secret: true } : {}) };
  const skills = Object.entries(c.skills)
    .filter(([name]) => name.includes(filter.trim()))
    .sort(([a], [b]) => a.localeCompare(b, "ko"));

  return (
    <div style={{ overflow: "auto", padding: 16, display: "grid", gap: 16, alignContent: "start" }} data-testid="sheet">
      <div style={{ display: "grid", gap: 4 }}>
        {characters.length > 1 ? (
          <select className="input" aria-label="캐릭터 선택" value={c.id} onChange={(e) => onSelect(e.target.value)}>
            {characters.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        ) : (
          <strong style={{ fontSize: 16 }}>{c.name}</strong>
        )}
        <span style={{ color: "var(--muted)" }}>{c.occupation || "직업 없음"} · {c.age}세 · MOV {d.mov} · DB {d.damageBonus} · 체격 {d.build}</span>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {BARS.map(({ path, label }) => {
          const max = d.limits[path];
          const cur = c[path];
          return (
            <div key={path} style={{ display: "grid", gridTemplateColumns: "56px 1fr auto", gap: 8, alignItems: "center" }}>
              <span>{label}{path === "san" && <Hint term="san" />}{path === "luck" && <Hint term="luck" />}</span>
              <div style={{ height: 8, borderRadius: 4, background: "var(--panel-2)", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, (cur / max) * 100)}%`, height: "100%", background: path === "hp" ? "var(--danger)" : "var(--accent)" }} />
              </div>
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <button className="btn" style={{ height: 28, padding: "0 10px" }} aria-label={`${label} 감소`} disabled={!canEdit} onClick={() => onPatch(c.id, [{ path, delta: -1 }])}>−</button>
                <span className="mono" style={{ minWidth: 56, textAlign: "center" }} data-testid={`stat-${path}`}>{cur}/{max}</span>
                <button className="btn" style={{ height: 28, padding: "0 10px" }} aria-label={`${label} 증가`} disabled={!canEdit} onClick={() => onPatch(c.id, [{ path, delta: 1 }])}>+</button>
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} data-testid="conditions">
        {CONDITIONS.map((k) => {
          const on = c.conditions?.includes(k) ?? false;
          return (
            <button
              key={k}
              className="btn"
              style={{ height: 28, padding: "0 10px", ...(on ? { borderColor: "var(--danger)", color: "var(--danger)" } : {}) }}
              aria-pressed={on}
              disabled={!canEdit}
              onClick={() => onPatch(c.id, [{ path: "condition", name: k, on: !on }])}
            >
              {CONDITION_LABEL_KO[k]}
            </button>
          );
        })}
        <Hint term="condition" />
      </div>

      <SanPanel
        character={c}
        canAct={canAct}
        isKp={isKp}
        onCheck={(loss) => onSanCheck(c.id, loss)}
        onSetMadness={(value) => onPatch(c.id, [{ path: "madness", value }])}
        onNewDay={() => onNewDay(c.id)}
        onMadnessRoll={(mode) => onMadnessRoll(c.id, mode)}
      />

      <div style={{ display: "flex", gap: 8 }}>
        <select className="input" aria-label="보너스·페널티" value={bonus} onChange={(e) => setBonus(Number(e.target.value))}>
          <option value={2}>보너스 2</option>
          <option value={1}>보너스 1</option>
          <option value={0}>기본</option>
          <option value={-1}>페널티 1</option>
          <option value={-2}>페널티 2</option>
        </select>
        <select className="input" aria-label="난이도" value={difficulty ?? ""} onChange={(e) => setDifficulty((e.target.value || undefined) as RollOptions["difficulty"])}>
          <option value="">난이도 없음</option>
          <option value="regular">보통</option>
          <option value="hard">어려움</option>
          <option value="extreme">극단적</option>
        </select>
      </div>
      <div className="res-sub" style={{ display: "flex", gap: 12, marginTop: -8 }}>
        <span>보너스·페널티<Hint term="bonus" /></span>
        <span>난이도<Hint term="difficulty" /></span>
      </div>
      {isKp && (
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" aria-label="비밀 판정" checked={secret} onChange={(e) => setSecret(e.target.checked)} style={{ accentColor: "#7c86f7" }} />
          비밀 판정 (결과는 KP에게만 · 한 번만 적용)
        </label>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {CHARACTERISTIC_KEYS.map((k) => (
          <button key={k} className="btn" style={{ height: 48, display: "grid", lineHeight: 1.2, padding: "4px 0" }} disabled={!canAct} onClick={() => roll(c.id, k, opts)} aria-label={`${k} 굴리기`}>
            <span style={{ color: "var(--muted)", fontSize: 11 }}>{k}</span>
            <span className="mono">{c.characteristics[k]}</span>
          </button>
        ))}
      </div>

      {(c.weapons?.length ?? 0) > 0 && (
        <div style={{ display: "grid", gap: 6 }} data-testid="weapons">
          <strong>무기</strong>
          {c.weapons!.map((w, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center" }}>
              <span>
                {w.name} <span className="mono" style={{ color: "var(--muted)", fontSize: 12 }}>{w.skill} · {w.damage}</span>
              </span>
              <button className="btn" style={{ height: 28, padding: "0 10px" }} disabled={!canAct} onClick={() => roll(c.id, w.skill, opts)} aria-label={`${w.name} 공격`}>공격</button>
              <button className="btn" style={{ height: 28, padding: "0 10px" }} disabled={!canAct} onClick={() => onDamage(c.id, i)} aria-label={`${w.name} 피해`}>피해</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gap: 6 }}>
        <input className="input" aria-label="기능 찾기" placeholder="기능 찾기" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="res-sub" style={{ display: "flex", alignItems: "center", gap: 6 }} data-testid="grown-legend">
          <span aria-hidden>☑</span> 체크한 기능은 세션이 끝나면 성장 굴림을 해요
          <Hint term="grown" />
        </div>
        {skills.map(([name, s]) => (
          <div key={name} data-testid={`skill-${name}`} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 8, alignItems: "center" }}>
            <input type="checkbox" title="이번 세션에서 성공했어요 (행운으로 성공한 건 제외). 세션 끝에 성장 굴림을 해요." aria-label={`${name} 성장 표시`} checked={s.grown} disabled={!canEdit} onChange={(e) => onPatch(c.id, [{ path: "skill", name, grown: e.target.checked }])} style={{ accentColor: "#7c86f7" }} />
            <span>{name}</span>
            <span className="mono" style={{ color: "var(--muted)" }}>{s.value} <span style={{ fontSize: 11 }}>({half(s.value)}/{fifth(s.value)})</span></span>
            <button className="btn" style={{ height: 28, padding: "0 10px" }} disabled={!canAct} onClick={() => roll(c.id, name, opts)} aria-label={`${name} 굴리기`}>굴리기</button>
          </div>
        ))}
        {skills.length === 0 && <div style={{ color: "var(--muted)" }}>일치하는 기능이 없어요.</div>}
      </div>

      <label style={{ display: "grid", gap: 4 }}>
        소지품
        <textarea
          key={`pos-${c.id}-${c.rev}`}
          className="input"
          style={{ height: 64, padding: 12 }}
          defaultValue={c.possessions ?? ""}
          disabled={!canEditText}
          onBlur={(e) => e.currentTarget.value !== (c.possessions ?? "") && onPatch(c.id, [{ path: "possessions", value: e.currentTarget.value }])}
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        인물 배경
        <textarea
          key={`bg-${c.id}-${c.rev}`}
          className="input"
          style={{ height: 80, padding: 12 }}
          defaultValue={c.backstory ?? ""}
          disabled={!canEditText}
          onBlur={(e) => e.currentTarget.value !== (c.backstory ?? "") && onPatch(c.id, [{ path: "backstory", value: e.currentTarget.value }])}
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        메모
        <textarea
          key={`${c.id}-${c.rev}`}
          className="input"
          style={{ height: 80, padding: 12 }}
          defaultValue={c.notes}
          disabled={!canEditText}
          onBlur={(e) => e.currentTarget.value !== c.notes && onPatch(c.id, [{ path: "notes", value: e.currentTarget.value }])}
        />
      </label>
      {onRemove && (
        <button
          className="btn danger"
          style={{ justifySelf: "start" }}
          onClick={() => window.confirm(`'${c.name}'을(를) 이 룸에서 뺄까요? 시트 내용이 사라져요.${isKp ? "" : " 보관함의 원본은 그대로예요."}`) && onRemove(c.id)}
        >
          이 캐릭터 빼기
        </button>
      )}
    </div>
  );
}

/** 시트 탭이 비었을 때(룸에 캐릭터가 없을 때) 다음 행동을 알려 준다. */
export function SheetEmpty({ role, canLoad }: { role: "kp" | "pl" | "spectator"; canLoad: boolean }) {
  const text =
    role === "spectator"
      ? "관전자는 시트를 볼 수 없어요."
      : role === "kp"
        ? "아직 룸에 캐릭터가 없어요. 아래에서 보관함 캐릭터를 불러오거나 PL이 불러오길 기다려요."
        : canLoad
          ? "내 캐릭터가 아직 없어요. 아래에서 보관함 캐릭터를 불러와요. 보관함이 비었다면 로비의 ‘내 캐릭터’에서 먼저 만들어요."
          : "아직 내 캐릭터가 없어요.";
  return <div style={{ color: "var(--muted)" }} data-testid="sheet-empty">{text}</div>;
}
