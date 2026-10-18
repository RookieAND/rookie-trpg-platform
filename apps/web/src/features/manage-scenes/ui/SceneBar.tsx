"use client";
import { useEffect, useRef, useState } from "react";
import { josa, BGM_STOP, MAX_SCENES, type AudioTrack, type ClientCommand, type Scene } from "@coc-vtt/shared";
import type { Caller } from "@/shared/api";
import { ImageUploadButton, Menu, MenuLabel, onTabListKeyDown, useAsk } from "@/shared/ui";

/** GM의 장면 막대: 장면을 고르고, 만들고, 지금 장면으로 바꾼다(컷/페이드). 활성이 아닌 장면은 PL에게 보이지 않아 미리 꾸며 둘 수 있다. */
export function SceneBar({ me, scenes, tracks, activeId, viewId, onView, enabled, canActivate = enabled, send }: { me: Caller; scenes: Scene[]; tracks: AudioTrack[]; activeId: string; viewId: string; onView: (id: string) => void; enabled: boolean; canActivate?: boolean; send: (c: ClientCommand) => unknown }) {
  const ask = useAsk();
  const [name, setName] = useState("");
  const [bringParty, setBringParty] = useState(true); // PL 토큰을 새 장면으로 같이 가져갈지
  const viewing = scenes.find((s) => s.id === viewId);
  const isActive = viewId === activeId;
  const partyOpt = bringParty ? {} : { bringParty: false };
  const index = scenes.findIndex((s) => s.id === viewId);

  // 복제하면 새로 생긴 장면(원본 바로 뒤)을 바로 보여 준다.
  const copyFrom = useRef<Set<string> | null>(null);
  useEffect(() => {
    const before = copyFrom.current;
    if (!before) return;
    const added = scenes.find((s) => !before.has(s.id));
    if (!added) return;
    copyFrom.current = null;
    onView(added.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes]);
  const duplicate = (id: string) => {
    copyFrom.current = new Set(scenes.map((s) => s.id));
    if (send({ type: "scene.duplicate", data: { id } }) === false) copyFrom.current = null;
  };
  const move = (to: number) => viewing && send({ type: "scene.reorder", data: { id: viewing.id, index: to } });

  const create = () => {
    if (!name.trim()) return;
    if (send({ type: "scene.create", data: { name: name.trim() } }) !== false) setName("");
  };

  return (
    <div className="scenebar" data-testid="scenebar">
      {ask.node}
      <div className="scene-row">
        <div className="scene-tabs" role="tablist" aria-label="장면" onKeyDown={onTabListKeyDown}>
          {scenes.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === viewId} className="scene-tab" onClick={() => onView(s.id)}>
              {s.id === activeId && <span aria-label="진행 중" style={{ color: "var(--ok)" }}>● </span>}
              {s.start && <span aria-label="시작 장면" title="세션을 시작하면 이 장면이 열려요">▶ </span>}
              {s.name}
            </button>
          ))}
        </div>
        <input className="input" style={{ width: 112 }} aria-label="새 장면 이름" placeholder="+ 새 장면" value={name} disabled={!enabled} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
        <button className="btn sm" disabled={!enabled || !name.trim()} onClick={create}>추가</button>
      </div>
      {viewing && (
        <div className="scene-row tools">
          {!isActive && (
            <>
              <button className="btn sm" disabled={!canActivate} onClick={() => send({ type: "scene.activate", data: { id: viewing.id, transition: "cut", ...partyOpt } })}>바로 전환</button>
              <button className="btn sm" disabled={!canActivate} onClick={() => send({ type: "scene.activate", data: { id: viewing.id, transition: "fade", ...partyOpt } })}>페이드 전환</button>
              <label className="scene-hint" style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title="끄면 PL 토큰을 새 장면에 따로 만들어 주지 않아요">
                <input type="checkbox" data-testid="bring-party" checked={bringParty} onChange={(e) => setBringParty(e.target.checked)} />
                PL 토큰도 가져가기
              </label>
            </>
          )}
          {!isActive && <span className="scene-hint">준비 중 — PL에게 안 보여요</span>}
          <span className="scene-move" role="group" aria-label="장면 순서">
            <button type="button" className="btn sm" data-testid="scene-move-up" aria-label="장면을 앞으로 옮기기" title="이 장면을 앞으로 옮겨요" disabled={!enabled || index <= 0} onClick={() => move(index - 1)}>◀</button>
            <button type="button" className="btn sm" data-testid="scene-move-down" aria-label="장면을 뒤로 옮기기" title="이 장면을 뒤로 옮겨요" disabled={!enabled || index < 0 || index >= scenes.length - 1} onClick={() => move(index + 1)}>▶</button>
          </span>
          <button type="button" className="btn sm" data-testid="scene-duplicate" title="이 장면의 토큰·소품·안개·배경을 그대로 복사해요" disabled={!enabled || scenes.length >= MAX_SCENES} onClick={() => duplicate(viewing.id)}>복제</button>
          <Menu label="장면 설정" title="이 장면의 시작 지정, 배경, 배경음, 이름, 삭제" align="right">
            {(close) => (
              <>
                <MenuLabel>이 장면</MenuLabel>
                <button className="btn" aria-pressed={!!viewing.start} disabled={!enabled} onClick={() => { send({ type: "scene.setStart", data: { id: viewing.start ? null : viewing.id } }); close(); }}>
                  {viewing.start ? "시작 장면 해제" : "시작 장면으로"}
                </button>
                <ImageUploadButton className="btn" me={me} label="배경" current={viewing.background} disabled={!enabled} onUploaded={(image) => send({ type: "scene.background", data: { id: viewing.id, image } })} />
                {viewing.background && <button className="btn" disabled={!enabled} onClick={() => { send({ type: "scene.background", data: { id: viewing.id, image: null } }); close(); }}>배경 떼기</button>}
                {tracks.some((t) => t.kind === "bgm") && (
                  <select className="input" aria-label="장면 배경음" value={viewing.bgmTrackId ?? ""} disabled={!enabled} onChange={(e) => send({ type: "scene.setBgm", data: { id: viewing.id, trackId: e.target.value || null } })}>
                    <option value="">배경음 그대로 둠</option>
                    <option value={BGM_STOP}>■ 음악 정지</option>
                    {tracks.filter((t) => t.kind === "bgm").map((t) => (
                      <option key={t.id} value={t.id}>♪ {t.label}</option>
                    ))}
                  </select>
                )}
                <button className="btn" disabled={!enabled} onClick={async () => {
                  close();
                  const next = await ask.prompt({ title: "장면 이름 바꾸기", label: "장면 이름", initial: viewing.name, confirmLabel: "바꾸기" });
                  if (next) send({ type: "scene.rename", data: { id: viewing.id, name: next } });
                }}>이름 변경</button>
                {!isActive && <button className="btn" style={{ color: "var(--danger)" }} disabled={!enabled} onClick={async () => { close(); if (await ask.confirm({ title: `${josa(`'${viewing.name}'`, "을/를")} 지울까요?`, message: "장면 안의 토큰과 소품도 함께 지워져요.", confirmLabel: "장면 지우기", danger: true })) send({ type: "scene.remove", data: { id: viewing.id } }); }}>장면 삭제</button>}
              </>
            )}
          </Menu>
        </div>
      )}
    </div>
  );
}
