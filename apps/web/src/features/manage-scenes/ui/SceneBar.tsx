"use client";
import { useState } from "react";
import type { AudioTrack, ClientCommand, Scene } from "@coc-vtt/shared";
import type { Caller } from "@/shared/api";
import { ImageUploadButton } from "@/shared/ui";

/** KP의 장면 막대: 장면을 고르고, 만들고, 지금 장면으로 바꾼다(컷/페이드). 활성이 아닌 장면은 PL에게 보이지 않아 미리 꾸며 둘 수 있다. */
export function SceneBar({ me, scenes, tracks, activeId, viewId, onView, enabled, send }: { me: Caller; scenes: Scene[]; tracks: AudioTrack[]; activeId: string; viewId: string; onView: (id: string) => void; enabled: boolean; send: (c: ClientCommand) => unknown }) {
  const [name, setName] = useState("");
  const viewing = scenes.find((s) => s.id === viewId);
  const isActive = viewId === activeId;

  const create = () => {
    if (!name.trim()) return;
    send({ type: "scene.create", data: { name: name.trim() } });
    setName("");
  };

  return (
    <div className="scenebar" data-testid="scenebar">
      <div className="scene-tabs" role="tablist" aria-label="장면">
        {scenes.map((s) => (
          <button key={s.id} role="tab" aria-selected={s.id === viewId} className="scene-tab" onClick={() => onView(s.id)}>
            {s.id === activeId && <span aria-label="진행 중" style={{ color: "var(--accent)" }}>● </span>}
            {s.start && <span aria-label="시작 장면" title="세션을 시작하면 이 장면이 열려요">▶ </span>}
            {s.name}
          </button>
        ))}
      </div>
      <input className="input" style={{ width: 130, height: 28 }} aria-label="새 장면 이름" placeholder="새 장면" value={name} disabled={!enabled} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
      <button className="btn" style={{ height: 28 }} disabled={!enabled || !name.trim()} onClick={create}>추가</button>
      {viewing && !isActive && (
        <>
          <button className="btn primary" style={{ height: 28 }} disabled={!enabled} onClick={() => send({ type: "scene.activate", data: { id: viewing.id, transition: "cut" } })}>바로 전환</button>
          <button className="btn" style={{ height: 28 }} disabled={!enabled} onClick={() => send({ type: "scene.activate", data: { id: viewing.id, transition: "fade" } })}>페이드 전환</button>
          <button className="btn danger" style={{ height: 28 }} disabled={!enabled} onClick={() => window.confirm(`'${viewing.name}'과(와) 안의 오브젝트를 지울까요?`) && send({ type: "scene.remove", data: { id: viewing.id } })}>삭제</button>
        </>
      )}
      {viewing && (
        <button className="btn" style={{ height: 28 }} aria-pressed={!!viewing.start} disabled={!enabled} onClick={() => send({ type: "scene.setStart", data: { id: viewing.start ? null : viewing.id } })}>
          {viewing.start ? "시작 장면 해제" : "시작 장면으로"}
        </button>
      )}
      {viewing && <ImageUploadButton me={me} label="배경" disabled={!enabled} onUploaded={(image) => send({ type: "scene.background", data: { id: viewing.id, image } })} />}
      {viewing?.background && <button className="btn" style={{ height: 28 }} disabled={!enabled} onClick={() => send({ type: "scene.background", data: { id: viewing.id, image: null } })}>배경 떼기</button>}
      {viewing && tracks.some((t) => t.kind === "bgm") && (
        <select className="input" style={{ height: 28, width: 150 }} aria-label="장면 배경음" value={viewing.bgmTrackId ?? ""} disabled={!enabled} onChange={(e) => send({ type: "scene.setBgm", data: { id: viewing.id, trackId: e.target.value || null } })}>
          <option value="">배경음 없음</option>
          {tracks.filter((t) => t.kind === "bgm").map((t) => (
            <option key={t.id} value={t.id}>♪ {t.label}</option>
          ))}
        </select>
      )}
      {viewing && (
        <button className="btn" style={{ height: 28 }} disabled={!enabled} onClick={() => {
          const next = window.prompt("장면 이름", viewing.name);
          if (next?.trim()) send({ type: "scene.rename", data: { id: viewing.id, name: next.trim() } });
        }}>이름 변경</button>
      )}
    </div>
  );
}
