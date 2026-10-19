"use client";
import { useState } from "react";
import { LIMITS, type ClientCommand, type Initiative } from "@coc-vtt/shared";
import { StatusChips, useAsk } from "@/shared/ui";

/** 전투 순서. 모두가 보고, GM만 시작·넘기기·NPC 추가·DEX 수정을 한다. */
export function InitiativePanel({ initiative, isKp, enabled, send }: { initiative: Initiative | null; isKp: boolean; enabled: boolean; send: (c: ClientCommand) => unknown }) {
  const ask = useAsk();
  const [name, setName] = useState("");
  const [dex, setDex] = useState("50");
  const dexNum = Number(dex);
  const canAdd = enabled && name.trim().length > 0 && Number.isInteger(dexNum) && dexNum >= 0 && dexNum <= 200;

  const add = () => {
    if (!canAdd) return;
    if (send({ type: "initiative.add", data: { name: name.trim(), dex: dexNum } }) !== false) setName("");
  };

  if (!initiative) {
    return (
      <div className="panel" data-testid="initiative">
        <div style={{ color: "var(--muted)" }}>{isKp ? "진행 중인 전투가 없어요. 시작하면 룸의 캐릭터가 DEX 순서로 서요." : "진행 중인 전투가 없어요."}</div>
        {isKp && <button className="btn" style={{ justifySelf: "start" }} disabled={!enabled} onClick={() => send({ type: "initiative.start", data: {} })}>전투 시작</button>}
      </div>
    );
  }

  return (
    <div className="panel" data-testid="initiative">
      {ask.node}
      <div className="panel-head">
        <strong data-testid="initiative-round" style={{ flex: 1 }}>{initiative.round}라운드</strong>
        {isKp && (
          <>
            <button className="btn sm primary" disabled={!enabled || initiative.entries.length === 0} onClick={() => send({ type: "initiative.next", data: {} })}>다음 차례</button>
            <button className="btn sm danger" disabled={!enabled} onClick={async () => (await ask.confirm({ title: "전투를 끝낼까요?", confirmLabel: "전투 종료", danger: true })) && send({ type: "initiative.end", data: {} })}>전투 종료</button>
          </>
        )}
      </div>

      {initiative.entries.length === 0 && <div style={{ color: "var(--muted)" }}>순서에 아무도 없어요.</div>}
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {initiative.entries.map((e, i) => {
          const now = i === initiative.turn;
          return (
            <li
              key={e.id}
              data-testid="initiative-entry"
              aria-current={now ? "step" : undefined}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px", minHeight: 32, borderRadius: 6, border: `1px solid ${now ? "color-mix(in srgb, var(--accent) 50%, transparent)" : "transparent"}`, background: now ? "var(--panel-2)" : "none" }}
            >
              <span aria-hidden style={{ width: 14, color: "var(--accent)" }}>{now ? "▶" : ""}</span>
              <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
                {e.name}
                <StatusChips keys={e.status ?? []} testId="initiative-status" />
              </span>
              {isKp ? (
                <input
                  key={`${e.id}-${e.dex}`}
                  className="input mono"
                  style={{ width: 64 }}
                  type="number"
                  min={0}
                  max={200}
                  aria-label={`${e.name} DEX`}
                  defaultValue={e.dex}
                  disabled={!enabled}
                  onBlur={(ev) => {
                    const v = Number(ev.currentTarget.value);
                    if (Number.isInteger(v) && v >= 0 && v <= 200 && v !== e.dex) send({ type: "initiative.dex", data: { id: e.id, dex: v } });
                  }}
                />
              ) : (
                <span className="mono" style={{ color: "var(--muted)" }}>{e.hidden ? "DEX ?" : `DEX ${e.dex}`}</span>
              )}
              {isKp && <button className="btn sm ghost" aria-label={`${e.name} 빼기`} disabled={!enabled} onClick={() => send({ type: "initiative.remove", data: { id: e.id } })}>빼기</button>}
            </li>
          );
        })}
      </ol>

      {isKp && (
        <div style={{ display: "flex", gap: 8 }}>
          <input className="input" style={{ flex: 1 }} aria-label="NPC 이름" placeholder="NPC 이름" maxLength={LIMITS.initiativeName} value={name} disabled={!enabled} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <input className="input mono" style={{ width: 64 }} type="number" aria-label="NPC DEX" value={dex} disabled={!enabled} onChange={(e) => setDex(e.target.value)} />
          <button className="btn" disabled={!canAdd} onClick={add}>추가</button>
        </div>
      )}
    </div>
  );
}
