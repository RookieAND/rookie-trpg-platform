"use client";
import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, FileText, ImageOff, Lock, LockOpen, Trash2 } from "lucide-react";
import { LIMITS, type Character, type ClientCommand, type GameObject, type Member } from "@coc-vtt/shared";
import type { Caller } from "@/shared/api";
import { ImageUploadButton, LimitNote, Select } from "@/shared/ui";
import { newTokenName, uniqueName } from "../model/names";
import { MarkerButton } from "./MarkerButton";

interface PlacementInput {
  /** 토큰·소품을 놓을 장면(GM이 보고 있는 장면) */
  sceneId: string;
  /** 지금 장면의 토큰·소품(기본 이름이 겹치지 않게 보는 데 쓴다) */
  objects: GameObject[];
  /** 룸의 PL 목록 */
  players: Member[];
  send: (c: ClientCommand) => unknown;
}

/** 토큰·소품을 놓는 상태와 동작. 데스크톱 막대와 휴대폰 시트가 같은 것을 쓴다. */
export function usePlacement({ sceneId, objects, players, send }: PlacementInput) {
  const takenNames = objects.map((o) => o.name);
  // 새 토큰의 소유자 기본값은 "소유자 없음(NPC)". 첫 PL로 두면 괴물·경비 토큰이 PL 것이 되어 버린다.
  const [owner, setOwner] = useState(""); // "": 소유자 없음(NPC)
  const [newName, setNewName] = useState("");
  const ownerValid = owner === "" || players.some((p) => p.userId === owner);
  const effectiveOwner = ownerValid ? owner : "";
  const nameOf = (id: string) => players.find((p) => p.userId === id)?.name;

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
    const name = uniqueName(newTokenName(typed, forId ? nameOf(forId) : undefined, takenNames.length), takenNames);
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
  return { owner: effectiveOwner, setOwner, newName, setNewName, add, addAll, plTokens, allLocked, toggleLockAll, placeToken: () => (addToken(effectiveOwner, newName), setNewName("")) };
}
export type Placement = ReturnType<typeof usePlacement>;

/** 휴대폰 아래 줄의 ‘+ 토큰’ 버튼. 시트 안의 소유자·이름 칸과 같은 상태를 쓴다. */
export function QuickTokenButton({ placement, enabled }: { placement: Placement; enabled: boolean }) {
  return (
    <button className="btn primary" data-testid="quick-token" disabled={!enabled} title="PL이 움직일 수 있는 토큰(캐릭터·NPC)을 놓아요" onClick={placement.placeToken}>+ 토큰</button>
  );
}

/** 놓기 줄의 내용(이름표 제외). */
export function PlaceControls({ placement: p, enabled, players, withTokenButton = true }: { placement: Placement; enabled: boolean; players: Member[]; withTokenButton?: boolean }) {
  return (
    <>
      {withTokenButton && <button className="btn" disabled={!enabled} title="PL이 움직일 수 있는 토큰(캐릭터·NPC)을 놓아요" onClick={p.placeToken}>+ 토큰</button>}
      <Select className="dock-input" aria-label="새 토큰 소유자" title="새 토큰의 소유자예요" disabled={!enabled} value={p.owner} onChange={(e) => p.setOwner(e.target.value)}>
        <option value="">소유자 없음(NPC)</option>
        {players.map((pl) => <option key={pl.userId} value={pl.userId}>{pl.name}</option>)}
      </Select>
      <input className="dock-input" style={{ width: 96 }} aria-label="새 토큰 이름" placeholder="이름(선택)" title="비우면 소유자 이름이, 소유자가 없으면 ‘토큰N’이 쓰여요" value={p.newName} maxLength={LIMITS.objectName} disabled={!enabled}
        onChange={(e) => p.setNewName(e.target.value)} />
      {players.length > 1 && (
        <button className="btn" disabled={!enabled} title="PL마다 그 사람 이름으로 토큰을 하나씩 놓아요" onClick={p.addAll}>PL 전원 토큰 만들기</button>
      )}
      <button className="btn" data-testid="lock-all" aria-pressed={p.allLocked} disabled={!enabled || p.plTokens.length === 0} title={p.allLocked ? "PL 토큰의 잠금을 모두 풀어요" : "PL 토큰을 모두 잠가 움직이지 못하게 해요(전투 정리·컷신용)"} onClick={p.toggleLockAll}>
        {p.allLocked ? <LockOpen aria-hidden /> : <Lock aria-hidden />}{p.allLocked ? "이동 풀기" : "이동 잠금"}
      </button>
      <button className="btn" disabled={!enabled} title="가구·단서 같은 소품을 놓아요" onClick={() => p.add("prop", "object")}>+ 소품</button>
      <button className="btn" disabled={!enabled} title="PL에게 보이지 않는 메모용 소품을 놓아요" onClick={() => p.add("prop", "gm")}>+ GM 전용</button>
    </>
  );
}

interface SelectedInput {
  me: Caller;
  enabled: boolean;
  /** 룸의 PL 목록 */
  players: Member[];
  selected: GameObject;
  /** 룸의 시트들(토큰에 이어 줄 수 있는 것) */
  characters?: Character[];
  /** 이어진 시트를 시트 탭에서 연다 */
  onOpenSheet?: (characterId: string) => void;
  send: (c: ClientCommand) => unknown;
  onDeselect: () => void;
}

/** 선택한 토큰·소품의 이름·소유자·시트·잠금·삭제. 데스크톱에서는 지도 위 상자로, 휴대폰에서는 시트 안에 놓는다. */
export function SelectedControls({ me, enabled, players, selected, characters = [], onOpenSheet, send, onDeselect }: SelectedInput) {
  const [rename, setRename] = useState("");
  useEffect(() => setRename(selected.name), [selected.id, selected.name]);
  const commitRename = () => {
    const v = rename.trim();
    if (v && v !== selected.name) send({ type: "object.update", data: { id: selected.id, name: v.slice(0, 40) } });
  };
  return (
    <>
      <div className="sel-row sel-top">
        <span className="sel-field sel-name">
          <input className="dock-input" aria-label="선택한 토큰·소품 이름" value={rename} maxLength={LIMITS.objectName} disabled={!enabled}
            onChange={(e) => setRename(e.target.value)} onBlur={commitRename} onKeyDown={(e) => e.key === "Enter" && commitRename()} />
          <LimitNote label="이름" max={LIMITS.objectName} value={rename} />
        </span>
        <button className="btn" disabled={!enabled || !rename.trim() || rename.trim() === selected.name} onClick={commitRename}><Check aria-hidden />이름 바꾸기</button>
      </div>
      {selected.kind === "token" && (
        <div className="sel-row sel-fields">
        {selected.kind === "token" && (
          <label className="sel-field">
            <span className="sel-cap" aria-hidden>소유자</span>
            <Select className="dock-input" aria-label="선택한 토큰 소유자" disabled={!enabled} value={selected.ownerId ?? ""}
              onChange={(e) => send({ type: "object.update", data: { id: selected.id, ownerId: e.target.value || null } })}>
              <option value="">소유자 없음(NPC)</option>
              {selected.ownerId && !players.some((p) => p.userId === selected.ownerId) && <option value={selected.ownerId}>(나간 사람)</option>}
              {players.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </Select>
          </label>
        )}
        {selected.kind === "token" && characters.length > 0 && (
          <label className="sel-field" title="이 토큰에 캐릭터 시트를 이어요. 이으면 토큰 아래에 HP가 보이고, 토큰을 눌러 시트를 열 수 있어요">
            <span className="sel-cap" aria-hidden>시트</span>
            <Select className="dock-input" aria-label="시트 연결" disabled={!enabled} value={selected.characterId ?? ""}
              onChange={(e) => send({ type: "object.update", data: { id: selected.id, characterId: e.target.value || null } })}>
              <option value="">시트 연결 없음</option>
              {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </label>
        )}
        </div>
      )}
      <div className="sel-row sel-actions">
        {selected.kind === "token" && selected.characterId && (
          <>
            <button className="btn" data-testid="open-linked-sheet" disabled={!onOpenSheet} onClick={() => onOpenSheet?.(selected.characterId!)}><FileText aria-hidden />시트 열기</button>
            <button className="btn" data-testid="hp-public" aria-pressed={Boolean(selected.hpPublic)} disabled={!enabled}
              title="켜면 PL에게도 이 토큰의 HP 막대를 보여 줘요. NPC는 꺼 두면 GM에게만 보여요"
              onClick={() => send({ type: "object.update", data: { id: selected.id, hpPublic: !selected.hpPublic } })}>
              {selected.hpPublic ? <Eye aria-hidden /> : <EyeOff aria-hidden />}{selected.hpPublic ? "HP 공개 중" : "HP 공개"}
            </button>
          </>
        )}
        {selected.kind === "token" && <MarkerButton obj={selected} canSecret enabled={enabled} send={send} />}
        {selected.kind === "token" && (
          <button className="btn" aria-pressed={Boolean(selected.locked)} disabled={!enabled} title="잠그면 소유자도 이 토큰을 움직일 수 없어요"
            onClick={() => send({ type: "object.update", data: { id: selected.id, locked: !selected.locked } })}>
            {selected.locked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}{selected.locked ? "잠김" : "잠그기"}
          </button>
        )}
          <button className="btn" disabled={!enabled} onClick={() => send({ type: "object.update", data: { id: selected.id, layer: selected.layer === "gm" ? "object" : "gm" } })}>
            {selected.layer === "gm" ? <Eye aria-hidden /> : <EyeOff aria-hidden />}{selected.layer === "gm" ? "공개" : "숨기기"}
          </button>
          <ImageUploadButton me={me} label="이미지" current={selected.image} disabled={!enabled} onUploaded={(image) => send({ type: "object.update", data: { id: selected.id, image } })} />
          {selected.image && <button className="btn" disabled={!enabled} onClick={() => send({ type: "object.update", data: { id: selected.id, image: null } })}><ImageOff aria-hidden />이미지 떼기</button>}
          <button className="btn danger" disabled={!enabled} title="지워도 Ctrl+Z 로 되돌릴 수 있어요" onClick={() => (send({ type: "object.remove", data: { id: selected.id } }), onDeselect())}><Trash2 aria-hidden />삭제</button>
      </div>
    </>
  );
}

/** GM이 보드에 토큰·소품을 놓고, 숨기고, 지운다(데스크톱·태블릿 막대). */
export function ObjectToolbar({
  me,
  enabled,
  sceneId,
  objects,
  players,
  selected,
  characters = [],
  onOpenSheet,
  send,
  onDeselect,
  placement,
  placeDock = true,
}: {
  me: Caller;
  enabled: boolean;
  sceneId: string;
  objects: GameObject[];
  players: Member[];
  selected?: GameObject;
  characters?: Character[];
  onOpenSheet?: (characterId: string) => void;
  send: (c: ClientCommand) => unknown;
  onDeselect: () => void;
  /** 밖에서 만든 상태를 쓸 때(없으면 여기서 만든다) */
  placement?: Placement;
  /** false면 ‘놓기’ 줄은 그리지 않고 선택한 것의 도구만 그린다(놓기는 다른 곳의 묶음에 둔다) */
  placeDock?: boolean;
}) {
  const own = usePlacement({ sceneId, objects, players, send });
  const p = placement ?? own;
  return (
    <>
    {selected && (
      <div className="dock sel-panel" data-testid="selected-bar" data-lane="bottom">
        <span className="dock-label" title="선택한 토큰·소품의 이름과 소유자를 바꿔요">선택</span>
        <SelectedControls me={me} enabled={enabled} players={players} selected={selected} characters={characters} {...(onOpenSheet ? { onOpenSheet } : {})} send={send} onDeselect={onDeselect} />
      </div>
    )}
    {placeDock && (
      <div className="dock" style={{ bottom: 12 }}>
        <span className="dock-label" title="지금 보고 있는 장면에 토큰·소품을 놓아요">놓기</span>
        <PlaceControls placement={p} enabled={enabled} players={players} />
      </div>
    )}
    </>
  );
}
