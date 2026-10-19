"use client";
import { useEffect, useRef, useState } from "react";
import { josa, BGM_STOP, DEFAULT_GRID_SIZE, GRID_MAX, GRID_MIN, LIMITS, MAX_SCENES, type AudioTrack, type ClientCommand, type Scene } from "@coc-vtt/shared";
import type { Caller } from "@/shared/api";
import { useMediaQuery } from "@/shared/lib";
import { Hint, ImageUploadButton, LimitNote, Menu, MenuLabel, onTabListKeyDown, useAsk, useRoving } from "@/shared/ui";

/** 이 폭 이하(태블릿 세로·휴대폰)에서는 장면 막대를 한 줄로 접는다 */
export const COMPACT_QUERY = "(max-width: 1024px)";

/** GM의 장면 막대: 장면을 고르고, 만들고, 지금 장면으로 바꾼다(컷/페이드). 활성이 아닌 장면은 PL에게 보이지 않아 미리 꾸며 둘 수 있다. */
export function SceneBar({ me, scenes, tracks, activeId, viewId, onView, enabled, canActivate = enabled, send, notify }: { me: Caller; scenes: Scene[]; tracks: AudioTrack[]; activeId: string; viewId: string; onView: (id: string) => void; enabled: boolean; canActivate?: boolean; send: (c: ClientCommand) => unknown; /** 복제 같은 동작 결과를 한 줄로 알린다 */ notify?: (text: string) => void }) {
  const ask = useAsk();
  const compact = useMediaQuery(COMPACT_QUERY);
  const tabStops = useRoving<HTMLDivElement>('[role="tab"]');
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
    notify?.(`장면을 복제했어요 · ${added.name}`);
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

  const rename = async () => {
    const next = await ask.prompt({ title: "장면 이름 바꾸기", label: "장면 이름", initial: viewing?.name ?? "", maxLength: LIMITS.sceneName, confirmLabel: "바꾸기" });
    if (next && viewing) send({ type: "scene.rename", data: { id: viewing.id, name: next } });
  };
  const remove = async () => {
    if (viewing && (await ask.confirm({ title: `${josa(`'${viewing.name}'`, "을/를")} 지울까요?`, message: "장면 안의 토큰과 소품도 함께 지워져요.", confirmLabel: "장면 지우기", danger: true }))) send({ type: "scene.remove", data: { id: viewing.id } });
  };
  const newScene = async () => {
    const next = await ask.prompt({ title: "새 장면", label: "장면 이름", initial: "", maxLength: LIMITS.sceneName, confirmLabel: "만들기" });
    if (next) send({ type: "scene.create", data: { name: next } });
  };
  const activate = (transition: "cut" | "fade") => viewing && send({ type: "scene.activate", data: { id: viewing.id, transition, ...partyOpt } });
  const bringPartyBox = (
    <label className="scene-hint" style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title="끄면 PL 토큰을 새 장면에 따로 만들어 주지 않아요">
      <input type="checkbox" data-testid="bring-party" checked={bringParty} onChange={(e) => setBringParty(e.target.checked)} />
      PL 토큰도 가져가기
    </label>
  );
  const settings = (viewing: Scene, close: () => void) => (
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
      <GridSettings scene={viewing} enabled={enabled} send={send} />
      <button className="btn" disabled={!enabled} onClick={() => { close(); void rename(); }}>이름 변경</button>
      {!isActive && <button className="btn" style={{ color: "var(--danger)" }} disabled={!enabled} onClick={() => { close(); void remove(); }}>장면 삭제</button>}
    </>
  );
  const legend = (
    <Hint label="장면 표시 설명" text={<><b>●</b> 지금 PL에게 보이는 장면 · <b>▶</b> 세션을 시작하면 열리는 장면</>} />
  );

  // 좁은 화면: 지금 장면 하나와 목록(고르기), 전환·설정 메뉴만 한 줄에 둔다.
  if (compact) {
    return (
      <div className="scenebar compact" data-testid="scenebar">
        {ask.node}
        <div className="scene-row">
          <select className="input scene-select" data-testid="scene-select" aria-label="보는 장면" value={viewId} onChange={(e) => onView(e.target.value)}>
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>{`${s.id === activeId ? "● " : ""}${s.start ? "▶ " : ""}${s.name}${s.id === activeId ? " (진행 중)" : ""}`}</option>
            ))}
          </select>
          {viewing && !isActive && (
            <Menu label="전환" title="이 장면을 PL에게 보여요" align="right" testId="scene-activate-menu">
              {(close) => (
                <>
                  <MenuLabel>PL에게 보여 주기</MenuLabel>
                  <button className="btn" disabled={!canActivate} onClick={() => { activate("cut"); close(); }}>바로 전환</button>
                  <button className="btn" disabled={!canActivate} onClick={() => { activate("fade"); close(); }}>페이드 전환</button>
                  {bringPartyBox}
                </>
              )}
            </Menu>
          )}
          {viewing && (
            <Menu label="장면" title="새 장면, 복제, 순서, 배경, 이름" align="right" testId="scene-menu">
              {(close) => (
                <>
                  <MenuLabel>장면 목록</MenuLabel>
                  <button className="btn" disabled={!enabled || scenes.length >= MAX_SCENES} onClick={() => { close(); void newScene(); }}>+ 새 장면</button>
                  <button type="button" className="btn" data-testid="scene-duplicate" disabled={!enabled || scenes.length >= MAX_SCENES} onClick={() => { duplicate(viewing.id); close(); }}>복제</button>
                  <button type="button" className="btn" data-testid="scene-move-up" disabled={!enabled || index <= 0} onClick={() => { move(index - 1); close(); }}>앞으로 옮기기</button>
                  <button type="button" className="btn" data-testid="scene-move-down" disabled={!enabled || index < 0 || index >= scenes.length - 1} onClick={() => { move(index + 1); close(); }}>뒤로 옮기기</button>
                  {settings(viewing, close)}
                </>
              )}
            </Menu>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="scenebar" data-testid="scenebar">
      {ask.node}
      <div className="scene-row">
        <div className="scene-tabs" role="tablist" aria-label="장면" ref={tabStops.ref} onFocus={tabStops.onFocus} onKeyDown={onTabListKeyDown}>
          {scenes.map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === viewId} className="scene-tab" onClick={() => onView(s.id)}>
              {s.id === activeId && <span aria-label="진행 중" title="지금 PL에게 보이는 장면" style={{ color: "var(--ok)" }}>● </span>}
              {s.start && <span aria-label="시작 장면" title="세션을 시작하면 이 장면이 열려요">▶ </span>}
              {s.name}
            </button>
          ))}
        </div>
        {legend}
        <span className="scene-new">
          <input className="input" style={{ width: 112 }} aria-label="새 장면 이름" placeholder="+ 새 장면" value={name} maxLength={LIMITS.sceneName} disabled={!enabled} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          <LimitNote label="장면 이름" max={LIMITS.sceneName} value={name} />
        </span>
        <button className="btn sm" disabled={!enabled || !name.trim()} onClick={create}>추가</button>
      </div>
      {viewing && (
        <div className="scene-row tools">
          {!isActive && (
            <>
              <button className="btn sm" disabled={!canActivate} onClick={() => activate("cut")}>바로 전환</button>
              <button className="btn sm" disabled={!canActivate} onClick={() => activate("fade")}>페이드 전환</button>
              {bringPartyBox}
            </>
          )}
          {!isActive && <span className="scene-hint">준비 중 — PL에게 안 보여요</span>}
          <span className="scene-move" role="group" aria-label="장면 순서">
            <button type="button" className="btn sm" data-testid="scene-move-up" aria-label="장면을 앞으로 옮기기" title="이 장면을 앞으로 옮겨요" disabled={!enabled || index <= 0} onClick={() => move(index - 1)}>◀</button>
            <button type="button" className="btn sm" data-testid="scene-move-down" aria-label="장면을 뒤로 옮기기" title="이 장면을 뒤로 옮겨요" disabled={!enabled || index < 0 || index >= scenes.length - 1} onClick={() => move(index + 1)}>▶</button>
          </span>
          <button type="button" className="btn sm" data-testid="scene-duplicate" title="이 장면의 토큰·소품·안개·배경을 그대로 복사해요" disabled={!enabled || scenes.length >= MAX_SCENES} onClick={() => duplicate(viewing.id)}>복제</button>
          <Menu label="장면 설정" title="이 장면의 시작 지정, 배경, 배경음, 이름, 삭제" align="right">
            {(close) => settings(viewing, close)}
          </Menu>
        </div>
      )}
    </div>
  );
}

/** 장면 설정 메뉴 안의 격자: 보이기, 칸에 맞추기(모두의 기본값), 한 칸 크기. 정하지 않으면 격자가 없다. */
function GridSettings({ scene, enabled, send }: { scene: Scene; enabled: boolean; send: (c: ClientCommand) => unknown }) {
  const grid = scene.grid;
  const [size, setSize] = useState(String(grid?.size ?? DEFAULT_GRID_SIZE));
  useEffect(() => setSize(String(grid?.size ?? DEFAULT_GRID_SIZE)), [scene.id, grid?.size]);
  const n = Math.round(Number(size));
  const valid = Number.isFinite(n) && n >= GRID_MIN && n <= GRID_MAX;
  // 서버 응답이 오기 전에 연달아 눌러도 앞선 선택이 되돌려지지 않게, 마지막으로 보낸 값을 기억한다.
  const last = useRef({ size: grid?.size ?? DEFAULT_GRID_SIZE, show: grid?.show ?? false, snap: grid?.snap ?? false });
  useEffect(() => { last.current = { size: grid?.size ?? DEFAULT_GRID_SIZE, show: grid?.show ?? false, snap: grid?.snap ?? false }; }, [scene.id, grid?.size, grid?.show, grid?.snap]);
  const push = (patch: { size?: number; show?: boolean; snap?: boolean }) => {
    last.current = { ...last.current, ...patch };
    send({ type: "scene.grid", data: { id: scene.id, ...last.current } });
  };
  const commitSize = () => {
    if (valid && n !== (grid?.size ?? DEFAULT_GRID_SIZE)) push({ size: n });
    else if (!valid) setSize(String(grid?.size ?? DEFAULT_GRID_SIZE));
  };
  return (
    <div className="grid-settings" data-testid="grid-settings">
      <MenuLabel>격자</MenuLabel>
      <label className="check"><input type="checkbox" data-testid="grid-show" checked={grid?.show ?? false} disabled={!enabled} onChange={(e) => push({ show: e.target.checked })} /> 격자 보이기</label>
      <label className="check"><input type="checkbox" data-testid="grid-snap" checked={grid?.snap ?? false} disabled={!enabled} onChange={(e) => push({ snap: e.target.checked })} /> 토큰을 칸에 맞추기</label>
      <label className="check">
        한 칸
        <input className="input" style={{ width: 72 }} type="number" inputMode="numeric" min={GRID_MIN} max={GRID_MAX} step={5} data-testid="grid-size" aria-label="격자 한 칸 크기" aria-invalid={!valid} value={size} disabled={!enabled}
          onChange={(e) => setSize(e.target.value)} onBlur={commitSize} onKeyDown={(e) => e.key === "Enter" && commitSize()} />
        <span className="why">{GRID_MIN}~{GRID_MAX}</span>
      </label>
    </div>
  );
}
