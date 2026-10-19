"use client";
import { useState } from "react";
import { LIMITS, josa, type Character, type DamageApplied, type RollAsk } from "@coc-vtt/shared";

const LEVEL: Record<string, string> = { regular: "보통", hard: "어려움", extreme: "극단적" };

/** GM이 판정을 요청하는 줄. 평소엔 한 줄로 접혀 있다. 기능 이름과 받는 사람, 난이도를 정해 보낸다. */
export function AskForm({
  players,
  disabled,
  onAsk,
  onGroup,
}: {
  players: Array<{ userId: string; name: string }>;
  disabled: boolean;
  onAsk: (name: string, difficulty: RollAsk["difficulty"], targetUserId?: string) => unknown;
  /** 그룹 판정: 서버가 PL들의 캐릭터로 한꺼번에 굴려 한 항목으로 남긴다. */
  onGroup?: (name: string, difficulty: RollAsk["difficulty"], targetUserId?: string, secret?: boolean) => unknown;
}) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(false);
  const [secret, setSecret] = useState(false);
  const send = () => {
    const n = name.trim();
    if (!n || disabled) return;
    const diff = (difficulty || undefined) as RollAsk["difficulty"];
    const sent = group && onGroup ? onGroup(n, diff, target || undefined, secret) : onAsk(n, diff, target || undefined);
    if (sent !== false) { setName(""); setOpen(false); setSecret(false); }
  };
  return (
    <div className="ask" data-testid="roll-ask-form">
      <button type="button" className="disclose" aria-expanded={open} title="PL에게 “이 기능으로 굴려 주세요”라고 알려요" onClick={() => setOpen((o) => !o)}>
        <span aria-hidden className="disclose-caret">{open ? "▾" : "▸"}</span>판정 요청
      </button>
      {open && (
        <div className="ask-fields">
          <input className="input" style={{ flex: "1 1 100%" }} aria-label="요청할 기능" placeholder="기능 이름 (예: 관찰력)" maxLength={LIMITS.rollName} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
          <select className="input" style={{ flex: "1 1 0", minWidth: 0 }} aria-label="요청 받을 사람" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">PL 전원</option>
            {players.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
          </select>
          <select className="input" style={{ flex: "1 1 0", minWidth: 0 }} aria-label="요청 난이도" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="">난이도 없음</option>
            <option value="regular">보통</option>
            <option value="hard">어려움</option>
            <option value="extreme">극단적</option>
          </select>
          {onGroup && (
            <label className="check" style={{ flex: "1 1 100%" }} title="PL들이 직접 누르지 않고 서버가 캐릭터 시트로 한꺼번에 굴려요. 결과는 한 항목으로 남아요.">
              <input type="checkbox" aria-label="그룹 판정" checked={group} onChange={(e) => setGroup(e.target.checked)} style={{ accentColor: "#7c86f7" }} />
              한꺼번에 굴리기 (그룹 판정)
            </label>
          )}
          {group && (
            <label className="check" style={{ flex: "1 1 100%" }}>
              <input type="checkbox" aria-label="그룹 비밀 굴림" checked={secret} onChange={(e) => setSecret(e.target.checked)} style={{ accentColor: "#7c86f7" }} />
              비밀 굴림
            </label>
          )}
          <button className="btn" data-testid="ask-send" disabled={disabled || !name.trim()} onClick={send}>{group ? "그룹 굴리기" : "요청 보내기"}</button>
        </div>
      )}
    </div>
  );
}

/** PL에게 온 판정 요청. 누르면 내 캐릭터로 그 기능을 굴린다. */
export function AskBanner({ asks, userId, canRoll, hasCharacter, onRoll }: { asks: RollAsk[]; userId: string; canRoll: boolean; hasCharacter: boolean; onRoll: (name: string, difficulty: RollAsk["difficulty"]) => void }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const mine = asks.filter((a) => !done.has(a.id) && (!a.targetUserId || a.targetUserId === userId));
  const ask = mine[mine.length - 1];
  if (!ask) return null;
  const close = () => setDone(new Set([...done, ask.id]));
  return (
    <div className="banner" role="status" data-testid="roll-ask-banner" style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
      <span>GM이 <strong>{ask.name}</strong> 판정을 요청했어요{ask.difficulty ? ` (${LEVEL[ask.difficulty]})` : ""}.{!hasCharacter && " 먼저 캐릭터를 불러와요."}</span>
      <span style={{ display: "flex", gap: 6 }}>
        <button className="btn sm primary" disabled={!canRoll || !hasCharacter} onClick={() => { onRoll(ask.name, ask.difficulty); close(); }}>굴리기</button>
        <button className="btn sm ghost" onClick={close} aria-label="요청 닫기">닫기</button>
      </span>
    </div>
  );
}

/** 피해를 받고 중상이 된 캐릭터의 주인(과 GM)에게 건강 판정(CON)을 권하는 배너. */
export function ConBanner({ last, characters, canRoll, onRoll }: { last: { n: number; result: DamageApplied } | null; characters: Character[]; canRoll: boolean; onRoll: (characterId: string) => void }) {
  const [done, setDone] = useState(0);
  if (!last || last.n <= done || !last.result.conRoll) return null;
  const c = characters.find((x) => x.id === last.result.characterId);
  if (!c) return null;
  const close = () => setDone(last.n);
  return (
    <div className="banner" role="status" data-testid="con-banner" style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
      <span>{josa(c.name, "이/가")} 중상을 입었어요. 건강 판정(CON)을 해요.</span>
      <span style={{ display: "flex", gap: 6 }}>
        <button className="btn sm primary" data-testid="con-banner-roll" disabled={!canRoll} onClick={() => { onRoll(c.id); close(); }}>건강 판정</button>
        <button className="btn sm ghost" onClick={close} aria-label="건강 판정 안내 닫기">닫기</button>
      </span>
    </div>
  );
}
