"use client";
import { useState } from "react";
import { SanPanel } from "@/features/san-check";
import { CHARACTERISTIC_KEYS, CONDITIONS, CONDITION_LABEL_KO, deriveCharacter, fifth, half, type Character, type SheetOp, type StatPath } from "@coc-vtt/shared";

export interface RollOptions {
  bonus: number;
  difficulty?: "regular" | "hard" | "extreme";
}

interface Props {
  characters: Character[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 세션이 진행 중이고 관전자가 아닐 때만 true */
  canAct: boolean;
  onPatch: (characterId: string, ops: SheetOp[]) => void;
  onRoll: (characterId: string, name: string, opts: RollOptions) => void;
  isKp: boolean;
  onSanCheck: (characterId: string, loss: string) => void;
  onNewDay: (characterId: string) => void;
  onMadnessRoll: (characterId: string, mode: "realtime" | "summary") => void;
  onDamage: (characterId: string, weaponIndex: number) => void;
}

const BARS: Array<{ path: StatPath; label: string }> = [
  { path: "hp", label: "HP" },
  { path: "mp", label: "MP" },
  { path: "san", label: "SAN" },
  { path: "luck", label: "행운" },
];

/** 캐릭터 시트: 상태 바(±), 특성치·기능 굴리기, 성장 표시, 메모. */
export function SheetPanel({ characters, selectedId, onSelect, canAct, onPatch, onRoll, isKp, onSanCheck, onNewDay, onMadnessRoll, onDamage }: Props) {
  const c = characters.find((x) => x.id === selectedId) ?? characters[0];
  const [bonus, setBonus] = useState(0);
  const [difficulty, setDifficulty] = useState<RollOptions["difficulty"]>(undefined);
  const [filter, setFilter] = useState("");
  if (!c) return null;

  const d = deriveCharacter(c);
  const opts: RollOptions = { bonus, ...(difficulty ? { difficulty } : {}) };
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
            <div key={path} style={{ display: "grid", gridTemplateColumns: "44px 1fr auto", gap: 8, alignItems: "center" }}>
              <span>{label}</span>
              <div style={{ height: 8, borderRadius: 4, background: "var(--panel-2)", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, (cur / max) * 100)}%`, height: "100%", background: path === "hp" ? "var(--danger)" : "var(--accent)" }} />
              </div>
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <button className="btn" style={{ height: 28, padding: "0 10px" }} aria-label={`${label} 감소`} disabled={!canAct} onClick={() => onPatch(c.id, [{ path, delta: -1 }])}>−</button>
                <span className="mono" style={{ minWidth: 56, textAlign: "center" }} data-testid={`stat-${path}`}>{cur}/{max}</span>
                <button className="btn" style={{ height: 28, padding: "0 10px" }} aria-label={`${label} 증가`} disabled={!canAct} onClick={() => onPatch(c.id, [{ path, delta: 1 }])}>+</button>
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} data-testid="conditions">
        {CONDITIONS.map((k) => {
          const on = c.conditions?.includes(k) ?? false;
          return (
            <button
              key={k}
              className="btn"
              style={{ height: 28, padding: "0 10px", ...(on ? { borderColor: "var(--danger)", color: "var(--danger)" } : {}) }}
              aria-pressed={on}
              disabled={!canAct}
              onClick={() => onPatch(c.id, [{ path: "condition", name: k, on: !on }])}
            >
              {CONDITION_LABEL_KO[k]}
            </button>
          );
        })}
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {CHARACTERISTIC_KEYS.map((k) => (
          <button key={k} className="btn" style={{ height: 48, display: "grid", lineHeight: 1.2, padding: "4px 0" }} disabled={!canAct} onClick={() => onRoll(c.id, k, opts)} aria-label={`${k} 굴리기`}>
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
              <button className="btn" style={{ height: 28, padding: "0 10px" }} disabled={!canAct} onClick={() => onRoll(c.id, w.skill, opts)} aria-label={`${w.name} 공격`}>공격</button>
              <button className="btn" style={{ height: 28, padding: "0 10px" }} disabled={!canAct} onClick={() => onDamage(c.id, i)} aria-label={`${w.name} 피해`}>피해</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gap: 6 }}>
        <input className="input" aria-label="기능 찾기" placeholder="기능 찾기" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {skills.map(([name, s]) => (
          <div key={name} data-testid={`skill-${name}`} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 8, alignItems: "center" }}>
            <input type="checkbox" aria-label={`${name} 성장 표시`} checked={s.grown} disabled={!canAct} onChange={(e) => onPatch(c.id, [{ path: "skill", name, grown: e.target.checked }])} style={{ accentColor: "#7c86f7" }} />
            <span>{name}</span>
            <span className="mono" style={{ color: "var(--muted)" }}>{s.value} <span style={{ fontSize: 11 }}>({half(s.value)}/{fifth(s.value)})</span></span>
            <button className="btn" style={{ height: 28, padding: "0 10px" }} disabled={!canAct} onClick={() => onRoll(c.id, name, opts)} aria-label={`${name} 굴리기`}>굴리기</button>
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
          disabled={!canAct}
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
          disabled={!canAct}
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
          disabled={!canAct}
          onBlur={(e) => e.currentTarget.value !== c.notes && onPatch(c.id, [{ path: "notes", value: e.currentTarget.value }])}
        />
      </label>
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
