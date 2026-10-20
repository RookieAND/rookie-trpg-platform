"use client";
import { useContextMenu, Select } from "@/shared/ui";
import { useMemo, useState } from "react";
import { formatRollLog, josa, luckBlockReason, luckNeeded, parseCommand, pushBlockReason, type Character, type RollLogEntry, type RollRuleInput } from "@coc-vtt/shared";
import { MacroBar, useRollMacros } from "@/features/roll-macros";
import { completeText, looksLikeDice, parseSkillQuery, resolveSkill, skillOptions, suggestSkills, type SkillDifficulty } from "@/features/skill-autocomplete";
import type { Caller } from "@/shared/api";
import { downloadText } from "@/shared/lib";
import { Hint } from "@/shared/ui";
import { RollResult } from "./RollResult";
import { AskForm } from "./RollAsk";
import { OpposedForm } from "./OpposedForm";

interface Props {
  me: Caller;
  rolls: RollLogEntry[];
  userId: string;
  characters: Character[];
  hidden: Array<{ id: string; userName: string }>;
  isKp: boolean;
  disabled: boolean;
  /** 관전자: 매크로 편집 같은 고치는 도구를 숨긴다 */
  readOnly?: boolean;
  /** 굴리지 못하는 이유 한 줄(disabled일 때 버튼 옆에 보여 준다) */
  disabledReason?: string | null;
  error: string | null;
  /** false를 돌려주면 보내지 못한 것이라 식을 지우지 않는다. */
  onRoll: (expr: string, secret: boolean, characterId?: string) => unknown;
  /** 시트의 기능·특성치 이름으로 굴린다(입력칸 자동완성). false를 돌려주면 보내지 못한 것이다. */
  onSkillRoll?: (characterId: string, name: string, o: { secret: boolean; bonus: number; difficulty?: SkillDifficulty }) => unknown;
  onPush: (rollId: string) => void;
  onLuck: (rollId: string) => void;
  /** GM 전용. 판정 요청 */
  players?: Array<{ userId: string; name: string }>;
  /** GM이 굴림 기록 한 줄을 지운다 */
  onRemove?: (id: string) => void;
  onAsk?: (name: string, difficulty: "regular" | "hard" | "extreme" | undefined, targetUserId?: string) => unknown;
  /** GM 전용. 그룹 판정(PL 전원 또는 한 명의 캐릭터가 한꺼번에 굴림) */
  onGroup?: (name: string, difficulty: "regular" | "hard" | "extreme" | undefined, targetUserId?: string, secret?: boolean) => unknown;
  /** 대항 판정. b는 캐릭터 id를 아는 GM은 characterId, PL은 상대 PL의 userId로 가리킨다. */
  onOpposed?: (a: { characterId: string; name: string }, b: { characterId?: string; userId?: string; name: string }, secret: boolean) => unknown;
  /** 이미 적용한 피해: 굴림 id → 캐릭터 id들 */
  damageApplied?: Record<string, string[]>;
  /** GM 전용. 피해 굴림 결과를 캐릭터 HP에 적용 */
  onApplyDamage?: (rollId: string, characterId: string, armor: number) => unknown;
}

export function RollPanel({ me, rolls, userId, characters, hidden, isKp, disabled, readOnly = false, disabledReason, error, onRoll, onSkillRoll, onPush, onLuck, players, onAsk, onGroup, onOpposed, damageApplied = {}, onApplyDamage, onRemove }: Props) {
  const ctx = useContextMenu();
  const [expr, setExpr] = useState("");
  const [secret, setSecret] = useState(false);
  const [help, setHelp] = useState(false);
  const macro = useRollMacros(me);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dbChar, setDbChar] = useState("");
  // 식에 db(피해 보너스)가 있으면 어느 캐릭터의 보너스를 쓸지 정한다. 시트가 하나뿐이면 그 시트다.
  const usesDb = /db/i.test(expr);
  const dbTarget = characters.find((c) => c.id === dbChar) ?? characters.find((c) => c.ownerId === userId) ?? characters[0];

  // 이름 자동완성: 굴릴 캐릭터는 PL이면 내 캐릭터, GM이면 고른 캐릭터.
  const [actorId, setActorId] = useState("");
  const [cursor, setCursor] = useState(-1);
  const [closed, setClosed] = useState(false);
  const actor = isKp ? (characters.find((c) => c.id === actorId) ?? characters[0]) : characters.find((c) => c.ownerId === userId);
  const options = useMemo(() => (actor ? skillOptions(actor) : []), [actor]);
  const query = onSkillRoll && actor ? parseSkillQuery(expr) : null;
  const suggestions = useMemo(() => (query && !looksLikeDice(query.name) ? suggestSkills(options, query.name) : []), [options, query?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const exact = query ? resolveSkill(options, query.name) : null;
  // 이름을 다 적어 한 개와 정확히 같으면 목록은 접는다(Enter로 바로 굴리게)
  const listOpen = !closed && !disabled && suggestions.length > 0 && !(suggestions.length === 1 && exact && suggestions[0] === exact);
  const pickSuggestion = (i: number) => {
    const o = suggestions[i];
    if (!o) return;
    setExpr(completeText(expr, o));
    setCursor(-1);
    setClosed(false);
  };
  const looksLikeName = Boolean(query) && !looksLikeDice(query?.name ?? "");

  const submit = () => {
    const text = expr.trim();
    if (!text || disabled) return;
    if (onSkillRoll && actor && query && looksLikeName) {
      if (!exact) return setLocalError(suggestions.length ? `'${query.name}'와 같은 이름을 목록에서 골라 주세요.` : `${actor.name}의 시트에서 '${query.name}'을(를) 찾지 못했어요.`);
      setLocalError(null);
      if (onSkillRoll(actor.id, exact.name, { secret: isKp && secret, bonus: query.bonus, ...(query.difficulty ? { difficulty: query.difficulty } : {}) }) !== false) {
        setExpr("");
        setSecret(false);
      }
      return;
    }
    // 서버가 같은 규칙으로 다시 검사한다. 먼저 이 자리에서 알려 주면 보내기 전에 고칠 수 있다.
    const parsed = parseCommand(text);
    if (!parsed.ok) return setLocalError(parsed.error);
    if (parsed.command.kind === "expr" && parsed.command.parsed.usesDb && !dbTarget) return setLocalError("db(피해 보너스)는 캐릭터 시트가 있어야 쓸 수 있어요.");
    setLocalError(null);
    if (onRoll(text, secret, parsed.command.kind === "expr" && parsed.command.parsed.usesDb ? dbTarget?.id : undefined) !== false) {
      setExpr("");
      setSecret(false); // 비밀 굴림은 한 번만. 다음 굴림이 실수로 비밀이 되지 않게 끈다.
    }
  };
  const macroRoll = (m: { expr: string; secret: boolean }) => {
    const parsed = parseCommand(m.expr);
    const needsDb = parsed.ok && parsed.command.kind === "expr" && parsed.command.parsed.usesDb;
    if (needsDb && !dbTarget) return setLocalError("db(피해 보너스)는 캐릭터 시트가 있어야 쓸 수 있어요.");
    setLocalError(null);
    onRoll(m.expr, isKp && m.secret, needsDb ? dbTarget?.id : undefined);
  };

  // 실패한 시트 판정에는 굴린 사람(또는 GM)이 푸시하거나 행운을 쓸 수 있다. 규칙상 안 되는 것은 이유를 보여 준다.
  const actions = (r: RollLogEntry) => {
    if (!r.check || r.secret || r.outcome.kind !== "cc" || r.outcome.success !== false) return null;
    if (r.userId !== userId && !isKp) return null;
    const c = characters.find((x) => x.id === r.check?.characterId);
    const input: RollRuleInput = {
      name: r.check.name,
      outcome: r.outcome,
      isPush: Boolean(r.pushOf),
      pushed: rolls.some((x) => x.pushOf === r.id),
      luckUsed: rolls.some((x) => x.luckOf === r.id),
      weaponSkills: (c?.weapons ?? []).map((w) => w.skill),
    };
    const pushWhy = pushBlockReason(input);
    const luckWhy = luckBlockReason(input);
    const need = luckNeeded(r.outcome);
    const luck = c?.luck ?? 0;
    // 이미 푸시했거나 행운을 쓴 뒤에는 조용히 둔다. 그 밖의 금지 사유는 한 줄로 알린다.
    const done = input.pushed || input.luckUsed || input.isPush;
    const notes = done ? [] : [pushWhy, luckWhy].filter((w, i, a): w is string => Boolean(w) && a.indexOf(w) === i);
    return (
      <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!pushWhy && (
            <>
              <button className="btn sm" disabled={disabled} title="같은 조건으로 한 번 더 굴려요. 또 실패하면 더 나쁜 일이 생길 수 있어요." onClick={() => onPush(r.id)}>푸시</button>
              <Hint term="push" />
            </>
          )}
          {!luckWhy && need !== null && (
            <>
              <button className="btn sm" disabled={disabled || luck < need} title={luck < need ? `행운이 모자라요 (보유 ${luck})` : `행운 ${josa(String(need), "을/를")} 깎아 성공으로 바꿔요`} onClick={() => onLuck(r.id)}>
                행운 {need} 쓰기
              </button>
              <Hint term="luck" />
              {luck < need && <span className="res-sub">행운이 모자라요 (보유 {luck})</span>}
            </>
          )}
        </div>
        {notes.map((w) => (
          <div key={w} className="res-sub" data-testid="rule-note">{w}</div>
        ))}
      </div>
    );
  };

  return (
    <>
      {ctx.menu}
      <div className="log" data-testid="roll-log" aria-live="polite">
        {rolls.length === 0 && hidden.length === 0 && <div style={{ color: "var(--muted)" }}>아직 굴림이 없어요. 아래 주사위 칩이나 식으로 굴려 보세요.</div>}
        {[...rolls].reverse().map((r) => (
          <div key={r.id} className="log-item" data-testid="roll-entry" onContextMenu={isKp && onRemove ? ctx.onContextMenu([{ label: "이 굴림 지우기", danger: true, onSelect: () => onRemove(r.id) }]) : undefined}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <strong>{r.userName}</strong>
              {r.label && <span style={{ color: "var(--muted)" }}>{r.label}</span>}
              {r.secret && <span className="badge paused">비밀 굴림</span>}
              {r.pushOf && <span className="badge">푸시</span>}
              {r.luckOf && <span className="badge">행운</span>}
              <span className="mono" style={{ color: "var(--muted)", marginLeft: "auto" }}>{r.expr}</span>
            </div>
            <RollResult outcome={r.outcome} />
            {actions(r)}
            {r.damage && isKp && onApplyDamage && <DamageApply roll={r} characters={characters} applied={damageApplied[r.id] ?? []} disabled={disabled} onApply={onApplyDamage} />}
          </div>
        ))}
        {hidden.map((h) => (
          <div key={h.id} className="log-item" data-testid="roll-hidden" style={{ color: "var(--muted)" }}>
            {h.userName}님이 비밀 굴림을 했어요.
          </div>
        ))}
      </div>
      <div className="compose">
        <MacroBar error={macro.error} macros={macro.macros} isKp={isKp} readOnly={readOnly} disabled={disabled} onRoll={macroRoll} onAdd={macro.add} onRemove={macro.remove} />
        {isKp && onAsk && <AskForm players={players ?? []} disabled={disabled} onAsk={onAsk} {...(onGroup ? { onGroup } : {})} />}
        {onOpposed && <OpposedForm isKp={isKp} disabled={disabled} userId={userId} characters={characters} players={players ?? []} onOpposed={onOpposed} />}
        {!readOnly && (
          <div className="quick-dice" role="group" aria-label="빠른 주사위" data-testid="quick-dice">
            {["1d100", "1d20", "1d10", "1d8", "1d6", "1d4"].map((d) => (
              <button key={d} type="button" className="btn sm mono" disabled={disabled} title={`${d} 바로 굴리기${isKp && secret ? " (비밀)" : ""}`}
                onClick={() => macroRoll({ expr: d, secret })}>{d.replace("1d", "d")}</button>
            ))}
          </div>
        )}
        <div className="row">
          <div className="skill-ac">
            <input
              className="input mono"
              role="combobox"
              aria-label="굴림 식"
              aria-autocomplete="list"
              aria-expanded={listOpen}
              aria-controls="skill-ac-list"
              aria-activedescendant={listOpen && cursor >= 0 ? `skill-ac-${cursor}` : undefined}
              aria-describedby={disabled && disabledReason ? "roll-why" : undefined}
              placeholder="CC<=60 · 1d100 · 관찰력"
              value={expr}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => { setExpr(e.target.value); setCursor(-1); setClosed(false); if (localError) setLocalError(null); }}
              onBlur={() => setClosed(true)}
              onFocus={() => setClosed(false)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 한글 조합 중 Enter는 글자를 끝맺는 키다
                if (listOpen && e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % suggestions.length); return; }
                if (listOpen && e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c <= 0 ? suggestions.length - 1 : c - 1)); return; }
                if (listOpen && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setClosed(true); return; }
                if (listOpen && e.key === "Tab" && !e.shiftKey) { e.preventDefault(); pickSuggestion(cursor >= 0 ? cursor : 0); return; }
                if (e.key === "Enter") {
                  if (listOpen && cursor >= 0) { e.preventDefault(); pickSuggestion(cursor); return; }
                  submit();
                }
              }}
            />
            {listOpen && (
              <ul className="skill-ac-list" id="skill-ac-list" role="listbox" aria-label="기능 이름 후보" data-testid="skill-ac-list">
                {suggestions.map((o, i) => (
                  <li key={o.name} id={`skill-ac-${i}`} role="option" aria-selected={i === cursor} className={i === cursor ? "on" : ""} data-testid="skill-ac-option" onMouseDown={(e) => { e.preventDefault(); pickSuggestion(i); }}>
                    <span>{o.name}</span>
                    <span className="mono muted">{o.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button className="btn primary" onClick={submit} disabled={disabled || !expr.trim()} aria-describedby={disabled && disabledReason ? "roll-why" : undefined}>굴리기</button>
        </div>
        {disabled && disabledReason && <div className="why" id="roll-why" data-testid="roll-why">{disabledReason}</div>}
        {isKp && onSkillRoll && characters.length > 1 && looksLikeName && (
          <Select className="input" aria-label="이름으로 굴릴 캐릭터" data-testid="skill-actor" value={actor?.id ?? ""} onChange={(e) => setActorId(e.target.value)}>
            {characters.map((c) => <option key={c.id} value={c.id}>{c.name}(으)로 굴리기</option>)}
          </Select>
        )}
        {usesDb && characters.length > 1 && (
          <Select className="input" aria-label="db를 쓸 캐릭터" value={dbTarget?.id ?? ""} onChange={(e) => setDbChar(e.target.value)}>
            {characters.map((c) => <option key={c.id} value={c.id}>{c.name}의 피해 보너스</option>)}
          </Select>
        )}
        {(localError || error) && <div className="err" role="alert" data-testid="roll-expr-error">{localError ?? error}</div>}
        <div className="row foot">
          {isKp && (
            <label className="check" title="결과는 GM에게만 보여요. 한 번만 적용돼요.">
              <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} style={{ accentColor: "#7c86f7" }} />
              비밀 굴림
            </label>
          )}
          <span className="spacer" />
          <button className="btn ghost sm" aria-expanded={help} onClick={() => setHelp((h) => !h)}>규칙 도움말</button>
          <button
            className="btn ghost sm"
            disabled={rolls.length === 0}
            title="이 화면에서 볼 수 있었던 굴림을 마크다운 파일로 저장해요"
            onClick={() => {
              const d = new Date();
              const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
              downloadText(`roll-log-${day}.md`, formatRollLog(rolls, { title: "굴림 기록", isKp }));
            }}
          >
            굴림 기록 저장
          </button>
        </div>
        {help && (
          <div className="res-sub row">
            <span>성공 단계<Hint term="level" /></span>
            <span>보너스·페널티<Hint term="bonus" /></span>
            <span>푸시<Hint term="push" /></span>
            <span>행운<Hint term="luck" /></span>
          </div>
        )}
      </div>
    </>
  );
}

/** 피해 굴림 결과를 GM이 캐릭터 HP에 적용한다. 방어구 값을 빼고, 같은 피해는 같은 캐릭터에게 한 번만 들어간다. */
function DamageApply({ roll, characters, applied, disabled, onApply }: { roll: RollLogEntry; characters: Character[]; applied: string[]; disabled: boolean; onApply: (rollId: string, characterId: string, armor: number) => unknown }) {
  const [target, setTarget] = useState("");
  const [armor, setArmor] = useState("0");
  const total = roll.outcome.kind === "dice" ? roll.outcome.total : 0;
  const armorN = /^\d{1,2}$/.test(armor.trim()) ? Number(armor.trim()) : null;
  const pick = characters.find((c) => c.id === target) ?? characters.find((c) => !applied.includes(c.id)) ?? characters[0];
  const done = pick ? applied.includes(pick.id) : false;
  const names = applied.map((id) => characters.find((c) => c.id === id)?.name).filter((n): n is string => Boolean(n));
  return (
    <div className="dmg-apply" data-testid="damage-apply">
      <Select className="input" aria-label="피해를 받을 캐릭터" value={pick?.id ?? ""} onChange={(e) => setTarget(e.target.value)}>
        {characters.map((c) => <option key={c.id} value={c.id}>{c.name}{applied.includes(c.id) ? " (적용됨)" : ""}</option>)}
      </Select>
      <input className="input mono num" inputMode="numeric" aria-label="방어구" title="피해에서 뺄 방어구 값" placeholder="방어구" value={armor} onChange={(e) => setArmor(e.target.value)} />
      <button
        className="btn sm"
        data-testid="damage-apply-btn"
        disabled={disabled || !pick || done || armorN === null}
        title={done ? "이 피해는 이미 이 캐릭터에게 적용했어요" : `피해 ${total}에서 방어구를 빼고 HP에 적용해요`}
        onClick={() => pick && armorN !== null && onApply(roll.id, pick.id, armorN)}
      >
        피해 적용
      </button>
      {names.length > 0 && <span className="res-sub" data-testid="damage-applied">적용됨: {names.join(", ")}</span>}
    </div>
  );
}
