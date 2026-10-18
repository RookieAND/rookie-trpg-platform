"use client";
import type { ClientCommand, GameObject } from "@coc-vtt/shared";
import type { Caller } from "@/shared/api";
import { ImageUploadButton } from "@/shared/ui";

/** KP가 보드에 토큰·소품을 놓고, 숨기고, 지운다. */
export function ObjectToolbar({
  me,
  enabled,
  sceneId,
  objectCount,
  firstPlayerId,
  selected,
  send,
  onDeselect,
}: {
  me: Caller;
  enabled: boolean;
  /** 오브젝트를 놓을 장면(KP가 보고 있는 장면) */
  sceneId: string;
  objectCount: number;
  firstPlayerId?: string;
  selected?: GameObject;
  send: (c: ClientCommand) => unknown;
  onDeselect: () => void;
}) {
  const add = (kind: "token" | "prop", layer: "object" | "gm") => {
    const label = kind === "token" ? "토큰" : "소품";
    send({
      type: "object.add",
      data: {
        kind,
        name: `${layer === "gm" ? "숨김 " : ""}${label}${objectCount + 1}`,
        x: 500,
        y: 400,
        layer,
        sceneId,
        visibleTo: "all",
        ...(kind === "token" && firstPlayerId ? { ownerId: firstPlayerId } : {}),
      },
    });
  };

  return (
    <div className="dock" style={{ bottom: 12 }}>
      <span className="dock-label" title="지금 보고 있는 장면에 오브젝트를 놓아요">놓기</span>
      <button className="btn" disabled={!enabled} title="PL이 움직일 수 있는 토큰(캐릭터·NPC)을 놓아요" onClick={() => add("token", "object")}>+ 토큰</button>
      <button className="btn" disabled={!enabled} title="가구·단서 같은 소품을 놓아요" onClick={() => add("prop", "object")}>+ 소품</button>
      <button className="btn" disabled={!enabled} title="PL에게 보이지 않는 메모용 오브젝트를 놓아요" onClick={() => add("prop", "gm")}>+ GM 전용</button>
      {selected && (
        <>
          <button className="btn" disabled={!enabled} onClick={() => send({ type: "object.update", data: { id: selected.id, layer: selected.layer === "gm" ? "object" : "gm" } })}>
            {selected.layer === "gm" ? "공개" : "숨기기"}
          </button>
          <ImageUploadButton me={me} label="이미지" disabled={!enabled} onUploaded={(image) => send({ type: "object.update", data: { id: selected.id, image } })} />
          {selected.image && <button className="btn" disabled={!enabled} onClick={() => send({ type: "object.update", data: { id: selected.id, image: null } })}>이미지 떼기</button>}
          <button className="btn danger" disabled={!enabled} onClick={() => (send({ type: "object.remove", data: { id: selected.id } }), onDeselect())}>삭제</button>
        </>
      )}
    </div>
  );
}
