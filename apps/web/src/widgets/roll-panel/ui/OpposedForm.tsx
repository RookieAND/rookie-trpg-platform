"use client";
import { useId, useState } from "react";
import { Select } from "@/shared/ui";
import { LIMITS, josa, type Character } from "@coc-vtt/shared";
import { commonSkillNames, skillOptions } from "../model/skill-options";

interface Props {
  isKp: boolean;
  disabled: boolean;
  userId: string;
  /** 내가 볼 수 있는 시트(GM은 전부, PL은 내 것) */
  characters: Character[];
  /** 룸의 PL들 */
  players: Array<{ userId: string; name: string }>;
  onOpposed: (a: { characterId: string; name: string }, b: { characterId?: string; userId?: string; name: string }, secret: boolean) => unknown;
}

/**
 * 대항 판정을 시작하는 줄. 평소엔 접혀 있다. GM은 아무 두 시트나 고르고,
 * PL은 내 캐릭터와 다른 PL을 고른다(상대 시트는 못 보니 기능 이름을 적는다). 보너스·페널티와 푸시는 없다.
 */
export function OpposedForm({ isKp, disabled, userId, characters, players, onOpposed }: Props) {
  const listId = useId();
  const mine = characters.filter((c) => c.ownerId === userId);
  const aChars = isKp ? characters : mine;
  const [open, setOpen] = useState(false);
  const [aId, setAId] = useState("");
  const [aSkill, setASkill] = useState("");
  const [bId, setBId] = useState("");
  const [bUser, setBUser] = useState("");
  const [bSkill, setBSkill] = useState("");
  const [secret, setSecret] = useState(false);

  const a = aChars.find((c) => c.id === aId) ?? aChars[0];
  const b = characters.find((c) => c.id === bId) ?? characters.find((c) => c.id !== a?.id);
  const others = players.filter((p) => p.userId !== userId);
  const bPlayer = others.find((p) => p.userId === bUser) ?? others[0];
  const aName = aSkill && skillOptions(a).includes(aSkill) ? aSkill : (skillOptions(a)[0] ?? "");
  const bName = isKp ? (bSkill && skillOptions(b).includes(bSkill) ? bSkill : (skillOptions(b)[0] ?? "")) : bSkill.trim();
  const ready = Boolean(a && aName && bName && (isKp ? b && b.id !== a.id : bPlayer));

  const why = !a
    ? "먼저 캐릭터를 불러와요."
    : !isKp && !bPlayer
      ? "맞설 다른 PL이 없어요. GM에게 대항 판정을 부탁해요."
      : isKp && characters.length < 2
        ? "시트가 두 개 이상 있어야 해요."
        : null;

  const send = () => {
    if (!ready || disabled || !a) return;
    const side = isKp ? (b ? { characterId: b.id, name: bName } : null) : bPlayer ? { userId: bPlayer.userId, name: bName } : null;
    if (!side) return;
    if (onOpposed({ characterId: a.id, name: aName }, side, isKp && secret) !== false) {
      setBSkill("");
      setSecret(false);
    }
  };

  return (
    <div className="ask" data-testid="opposed-form">
      <button type="button" className="disclose" aria-expanded={open} title="두 캐릭터가 각자 굴려 성공 단계를 비교해요" onClick={() => setOpen((o) => !o)}>
        <span aria-hidden className="disclose-caret">{open ? "▾" : "▸"}</span>대항 판정
      </button>
      {open && (
        <div className="ask-fields">
          {isKp ? (
            <>
              <div className="opp-row" role="group" aria-label="주도하는 쪽">
                <span className="opp-cap">주도</span>
                <Select className="input" aria-label="주도하는 캐릭터" value={a?.id ?? ""} onChange={(e) => { setAId(e.target.value); setASkill(""); }}>
                  {aChars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Select className="input" aria-label="주도하는 기능" value={aName} onChange={(e) => setASkill(e.target.value)}>
                  {skillOptions(a).map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </div>
              <div className="opp-row" role="group" aria-label="맞서는 쪽">
                <span className="opp-cap">맞섬</span>
                <Select className="input" aria-label="맞서는 캐릭터" value={b?.id ?? ""} onChange={(e) => { setBId(e.target.value); setBSkill(""); }}>
                  {characters.filter((c) => c.id !== a?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Select className="input" aria-label="맞서는 기능" value={bName} onChange={(e) => setBSkill(e.target.value)}>
                  {skillOptions(b).map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </div>
            </>
          ) : (
            <>
              <div className="opp-row" role="group" aria-label="주도하는 쪽">
                <span className="opp-cap">주도</span>
                <span className="res-sub opp-who">{a ? `${josa(a.name, "으로/로")} 굴려요` : ""}</span>
                <Select className="input" aria-label="주도하는 기능" value={aName} onChange={(e) => setASkill(e.target.value)}>
                  {skillOptions(a).map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </div>
              <div className="opp-row" role="group" aria-label="맞서는 쪽">
                <span className="opp-cap">맞섬</span>
                <Select className="input" aria-label="맞서는 PL" value={bPlayer?.userId ?? ""} onChange={(e) => setBUser(e.target.value)}>
                  {others.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                </Select>
                <input className="input" list={listId} aria-label="맞서는 기능" placeholder="상대 기능 (예: 회피)" maxLength={LIMITS.rollName} value={bSkill} onChange={(e) => setBSkill(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
                <datalist id={listId}>{commonSkillNames().map((n) => <option key={n} value={n} />)}</datalist>
              </div>
            </>
          )}
          <div className="res-sub" style={{ flex: "1 1 100%" }}>
            성공 단계가 높은 쪽이 이겨요. 둘 다 실패하면 맞서는 쪽이 유리하고, 보너스·페널티와 푸시는 없어요.
          </div>
          {isKp && (
            <label className="check" title="결과는 GM에게만 보여요. 한 번만 적용돼요.">
              <input type="checkbox" aria-label="대항 비밀 굴림" checked={secret} onChange={(e) => setSecret(e.target.checked)} style={{ accentColor: "#7c86f7" }} />
              비밀 굴림
            </label>
          )}
          <button className="btn" data-testid="opposed-submit" disabled={disabled || !ready} onClick={send}>대항 굴리기</button>
          {why && <div className="res-sub" data-testid="opposed-why" style={{ flex: "1 1 100%" }}>{why}</div>}
        </div>
      )}
    </div>
  );
}
