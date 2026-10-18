"use client";
import { useState } from "react";
import type { RollAsk } from "@coc-vtt/shared";

const LEVEL: Record<string, string> = { regular: "보통", hard: "어려움", extreme: "극단적" };

/** GM이 판정을 요청하는 줄. 평소엔 한 줄로 접혀 있다. 기능 이름과 받는 사람, 난이도를 정해 보낸다. */
export function AskForm({ players, disabled, onAsk }: { players: Array<{ userId: string; name: string }>; disabled: boolean; onAsk: (name: string, difficulty: RollAsk["difficulty"], targetUserId?: string) => unknown }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [open, setOpen] = useState(false);
  const send = () => {
    const n = name.trim();
    if (!n || disabled) return;
    if (onAsk(n, (difficulty || undefined) as RollAsk["difficulty"], target || undefined) !== false) { setName(""); setOpen(false); }
  };
  return (
    <div className="ask" data-testid="roll-ask-form">
      <button type="button" className="disclose" aria-expanded={open} title="PL에게 “이 기능으로 굴려 주세요”라고 알려요" onClick={() => setOpen((o) => !o)}>
        <span aria-hidden className="disclose-caret">{open ? "▾" : "▸"}</span>판정 요청
      </button>
      {open && (
        <div className="ask-fields">
          <input className="input" style={{ flex: "1 1 100%" }} aria-label="요청할 기능" placeholder="기능 이름 (예: 관찰력)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
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
          <button className="btn" disabled={disabled || !name.trim()} onClick={send}>요청 보내기</button>
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
