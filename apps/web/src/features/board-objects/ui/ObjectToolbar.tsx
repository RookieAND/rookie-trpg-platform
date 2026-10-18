"use client";
import { useEffect, useState } from "react";
import type { ClientCommand, GameObject, Member } from "@coc-vtt/shared";
import type { Caller } from "@/shared/api";
import { ImageUploadButton } from "@/shared/ui";
import { uniqueName } from "../model/names";

/** KP가 보드에 토큰·소품을 놓고, 숨기고, 지운다. */
export function ObjectToolbar({
  me,
  enabled,
  sceneId,
  objects,
  players,
  selected,
  send,
  onDeselect,
}: {
  me: Caller;
  enabled: boolean;
  /** 오브젝트를 놓을 장면(KP가 보고 있는 장면) */
  sceneId: string;
  /** 지금 장면의 오브젝트(기본 이름이 겹치지 않게 보는 데 쓴다) */
  objects: GameObject[];
  /** 룸의 PL 목록 */
  players: Member[];
  selected?: GameObject;
  send: (c: ClientCommand) => unknown;
  onDeselect: () => void;
}) {
  const takenNames = objects.map((o) => o.name);
  const [owner, setOwner] = useState<string | undefined>(undefined); // undefined: 첫 PL, "": 소유자 없음
  const [newName, setNewName] = useState("");
  const [rename, setRename] = useState("");
  const ownerId = owner === undefined ? (players[0]?.userId ?? "") : owner;
  const ownerValid = ownerId === "" || players.some((p) => p.userId === ownerId);
  const effectiveOwner = ownerValid ? ownerId : "";
  const nameOf = (id: string) => players.find((p) => p.userId === id)?.name;
  useEffect(() => setRename(selected?.name ?? ""), [selected?.id, selected?.name]);

  const add = (kind: "token" | "prop", layer: "object" | "gm") => {
    const label = kind === "token" ? "토큰" : "소품";
    send({
      type: "object.add",
      data: {
        kind,
        name: `${layer === "gm" ? "숨김 " : ""}${label}${objects.length + 1}`,
        x: 500,
        y: 400,
        layer,
        sceneId,
        visibleTo: "all",
        autoPlace: true,
      },
    });
  };
  const addToken = (forId: string, typed: string) => {
    const base = typed.trim() || (forId ? (nameOf(forId) ?? "") : "") || `토큰${objects.length + 1}`;
    const name = uniqueName(base, takenNames);
    takenNames.push(name);
    send({ type: "object.add", data: { kind: "token", name, x: 500, y: 400, layer: "object", sceneId, visibleTo: "all", autoPlace: true, ...(forId ? { ownerId: forId } : {}) } });
  };
  const addAll = () => {
    for (const p of players) addToken(p.userId, "");
  };
  // 전투 정리·컷신 때 PL 토큰을 한꺼번에 잠그거나 푼다. 하나씩 보내도 연결당 속도 제한(버스트 120)보다 훨씬 적다.
  const plTokens = objects.filter((o) => o.kind === "token" && o.ownerId);
  const allLocked = plTokens.length > 0 && plTokens.every((o) => o.locked);
  const toggleLockAll = () => {
    const locked = !allLocked;
    for (const o of plTokens) if (Boolean(o.locked) !== locked) send({ type: "object.update", data: { id: o.id, locked } });
  };
  const commitRename = () => {
    const v = rename.trim();
    if (selected && v && v !== selected.name) send({ type: "object.update", data: { id: selected.id, name: v.slice(0, 40) } });
  };

  return (
    <>
    {selected && (
      <div className="dock sel-panel" data-testid="selected-bar">
        <span className="dock-label" title="선택한 오브젝트의 이름과 소유자를 바꿔요">선택</span>
        <input className="dock-input" aria-label="선택한 오브젝트 이름" value={rename} maxLength={40} disabled={!enabled}
          onChange={(e) => setRename(e.target.value)} onBlur={commitRename} onKeyDown={(e) => e.key === "Enter" && commitRename()} />
        <button className="btn" disabled={!enabled || !rename.trim() || rename.trim() === selected.name} onClick={commitRename}>이름 바꾸기</button>
        {selected.kind === "token" && (
          <select className="dock-input" aria-label="선택한 토큰 소유자" disabled={!enabled} value={selected.ownerId ?? ""}
            onChange={(e) => send({ type: "object.update", data: { id: selected.id, ownerId: e.target.value || null } })}>
            <option value="">소유자 없음(NPC)</option>
            {selected.ownerId && !players.some((p) => p.userId === selected.ownerId) && <option value={selected.ownerId}>(나간 사람)</option>}
            {players.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
          </select>
        )}
        {selected.kind === "token" && (
          <button className="btn" aria-pressed={Boolean(selected.locked)} disabled={!enabled} title="잠그면 소유자도 이 토큰을 움직일 수 없어요"
            onClick={() => send({ type: "object.update", data: { id: selected.id, locked: !selected.locked } })}>
            {selected.locked ? "잠김" : "잠그기"}
          </button>
        )}
          <button className="btn" disabled={!enabled} onClick={() => send({ type: "object.update", data: { id: selected.id, layer: selected.layer === "gm" ? "object" : "gm" } })}>
            {selected.layer === "gm" ? "공개" : "숨기기"}
          </button>
          <ImageUploadButton me={me} label="이미지" disabled={!enabled} onUploaded={(image) => send({ type: "object.update", data: { id: selected.id, image } })} />
          {selected.image && <button className="btn" disabled={!enabled} onClick={() => send({ type: "object.update", data: { id: selected.id, image: null } })}>이미지 떼기</button>}
          <button className="btn danger" disabled={!enabled} title="지워도 Ctrl+Z 로 되돌릴 수 있어요" onClick={() => (send({ type: "object.remove", data: { id: selected.id } }), onDeselect())}>삭제</button>
      </div>
    )}
    <div className="dock" style={{ bottom: 12 }}>
      <span className="dock-label" title="지금 보고 있는 장면에 오브젝트를 놓아요">놓기</span>
      <button className="btn" disabled={!enabled} title="PL이 움직일 수 있는 토큰(캐릭터·NPC)을 놓아요" onClick={() => (addToken(effectiveOwner, newName), setNewName(""))}>+ 토큰</button>
      <select className="dock-input" aria-label="새 토큰 소유자" title="새 토큰의 소유자예요" disabled={!enabled} value={effectiveOwner} onChange={(e) => setOwner(e.target.value)}>
        <option value="">소유자 없음(NPC)</option>
        {players.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
      </select>
      <input className="dock-input" style={{ width: 96 }} aria-label="새 토큰 이름" placeholder="이름(선택)" title="비우면 PL 이름이 쓰여요" value={newName} maxLength={40} disabled={!enabled}
        onChange={(e) => setNewName(e.target.value)} />
      {players.length > 1 && (
        <button className="btn" disabled={!enabled} title="PL마다 그 사람 이름으로 토큰을 하나씩 놓아요" onClick={addAll}>PL 전원 토큰 만들기</button>
      )}
      <button className="btn" data-testid="lock-all" aria-pressed={allLocked} disabled={!enabled || plTokens.length === 0} title={allLocked ? "PL 토큰의 잠금을 모두 풀어요" : "PL 토큰을 모두 잠가 움직이지 못하게 해요(전투 정리·컷신용)"} onClick={toggleLockAll}>
        {allLocked ? "이동 풀기" : "이동 잠금"}
      </button>
      <button className="btn" disabled={!enabled} title="가구·단서 같은 소품을 놓아요" onClick={() => add("prop", "object")}>+ 소품</button>
      <button className="btn" disabled={!enabled} title="PL에게 보이지 않는 메모용 오브젝트를 놓아요" onClick={() => add("prop", "gm")}>+ GM 전용</button>
    </div>
    </>
  );
}
