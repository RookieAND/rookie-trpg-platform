"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, Flag, ImageOff, Pencil, Trash2 } from "lucide-react";
import { josa, BGM_STOP, DEFAULT_GRID_SIZE, GRID_MAX, GRID_MIN, LIMITS, MAX_SCENES, type AudioTrack, type ClientCommand, type Scene } from "@coc-vtt/shared";
import type { Caller } from "@/shared/api";
import { useMediaQuery } from "@/shared/lib";
import { Hint, ImageUploadButton, Menu, MenuLabel, onTabListKeyDown, useAsk, useRoving, Select } from "@/shared/ui";
import { dropIndicator, dropSide, reorderTarget, type DropSide } from "../model/drag-order";

/** 이 폭 이하(태블릿 세로·휴대폰)에서는 장면 막대를 한 줄로 접는다 */
export const COMPACT_QUERY = "(max-width: 1024px)";

/** GM의 장면 막대: 장면을 고르고, 만들고, 지금 장면으로 바꾼다(컷/페이드). 활성이 아닌 장면은 PL에게 보이지 않아 미리 꾸며 둘 수 있다. */
/** 장면 탭을 그대로 늘어놓는 최대 개수. 이보다 많으면 현재 장면 이동기+목록으로 바꾼다(시험에서 localStorage로 조절). */
function sceneTabsMax(): number {
  try {
    const v = Number(globalThis.localStorage?.getItem("rc-scene-tabs-max"));
    return Number.isFinite(v) && v > 0 ? v : 6;
  } catch {
    return 6;
  }
}

export function SceneBar({ me, scenes, tracks, activeId, viewId, onView, enabled, canActivate = enabled, send, notify }: { me: Caller; scenes: Scene[]; tracks: AudioTrack[]; activeId: string; viewId: string; onView: (id: string) => void; enabled: boolean; canActivate?: boolean; send: (c: ClientCommand) => unknown; /** 복제 같은 동작 결과를 한 줄로 알린다 */ notify?: (text: string) => void }) {
  const ask = useAsk();
  const compact = useMediaQuery(COMPACT_QUERY);
  const tabStops = useRoving<HTMLDivElement>('[role="tab"]');
  // 보는 장면의 탭이 가려져 있으면 보이는 자리로 가져온다(장면이 많을 때).
  const viewTab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = viewTab.current;
    const box = el?.closest<HTMLElement>(".scene-tabs");
    if (!el || !box) return;
    const a = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (a.left < b.left || a.right > b.right) box.scrollTo({ left: box.scrollLeft + (a.left - b.left) - (b.width - a.width) / 2, behavior: "smooth" });
  }, [viewId, scenes.length]);
  const [bringParty, setBringParty] = useState(true); // PL 토큰을 새 장면으로 같이 가져갈지
  const viewing = scenes.find((s) => s.id === viewId);
  const isActive = viewId === activeId;
  const partyOpt = bringParty ? {} : { bringParty: false };
  const index = scenes.findIndex((s) => s.id === viewId);
  const many = scenes.length > sceneTabsMax();

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

  // 탭 끌어서 순서 바꾸기(넓은 화면). 좁은 화면은 목록 선택이라 메뉴의 "앞으로·뒤로 옮기기"를 쓴다.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overTab, setOverTab] = useState<{ index: number; side: DropSide } | null>(null);
  const canReorder = enabled && scenes.length > 1;
  const endDrag = () => {
    setDragId(null);
    setOverTab(null);
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
      <MenuLabel>시작·배경·이름</MenuLabel>
      <button className="btn" aria-pressed={!!viewing.start} disabled={!enabled} onClick={() => { send({ type: "scene.setStart", data: { id: viewing.start ? null : viewing.id } }); close(); }}>
        <Flag aria-hidden />{viewing.start ? "시작 장면 해제" : "시작 장면으로"}
      </button>
      <ImageUploadButton className="btn" me={me} label="배경" current={viewing.background} disabled={!enabled} onUploaded={(image) => send({ type: "scene.background", data: { id: viewing.id, image } })} />
      {viewing.background && <button className="btn" disabled={!enabled} onClick={() => { send({ type: "scene.background", data: { id: viewing.id, image: null } }); close(); }}><ImageOff aria-hidden />배경 떼기</button>}
      {tracks.some((t) => t.kind === "bgm") && (
        <Select className="input" aria-label="장면 배경음" value={viewing.bgmTrackId ?? ""} disabled={!enabled} onChange={(e) => send({ type: "scene.setBgm", data: { id: viewing.id, trackId: e.target.value || null } })}>
          <option value="">배경음 그대로 둠</option>
          <option value={BGM_STOP}>■ 음악 정지</option>
          {tracks.filter((t) => t.kind === "bgm").map((t) => (
            <option key={t.id} value={t.id}>♪ {t.label}</option>
          ))}
        </Select>
      )}
      <GridSettings scene={viewing} enabled={enabled} send={send} />
      <button className="btn" disabled={!enabled} onClick={() => { close(); void rename(); }}><Pencil aria-hidden />이름 변경</button>
      {!isActive && <button className="btn" style={{ color: "var(--danger)" }} disabled={!enabled} onClick={() => { close(); void remove(); }}><Trash2 aria-hidden />장면 삭제</button>}
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
          <Select className="input scene-select" data-testid="scene-select" aria-label="보는 장면" value={viewId} onChange={(e) => onView(e.target.value)}>
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>{`${s.id === activeId ? "● " : ""}${s.start ? "▶ " : ""}${s.name}${s.id === activeId ? " (진행 중)" : ""}`}</option>
            ))}
          </Select>
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
                  <button type="button" className="btn" data-testid="scene-duplicate" disabled={!enabled || scenes.length >= MAX_SCENES} onClick={() => { duplicate(viewing.id); close(); }}><Copy aria-hidden />복제</button>
                  <button type="button" className="btn" data-testid="scene-move-up" disabled={!enabled || index <= 0} onClick={() => { move(index - 1); close(); }}><ArrowLeft aria-hidden />앞으로 옮기기</button>
                  <button type="button" className="btn" data-testid="scene-move-down" disabled={!enabled || index < 0 || index >= scenes.length - 1} onClick={() => { move(index + 1); close(); }}><ArrowRight aria-hidden />뒤로 옮기기</button>
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
        {many && (
          <div className="scene-current" data-testid="scene-current">
            <button type="button" className="btn sm ico" aria-label="이전 장면" disabled={index <= 0} onClick={() => onView(scenes[index - 1]!.id)}>‹</button>
            <SceneListMenu scenes={scenes} viewId={viewId} activeId={activeId} onView={onView} label={`${viewing?.id === activeId ? "● " : ""}${viewing?.start ? "▶ " : ""}${viewing?.name ?? "장면"}`} />
            <button type="button" className="btn sm ico" aria-label="다음 장면" disabled={index < 0 || index >= scenes.length - 1} onClick={() => onView(scenes[index + 1]!.id)}>›</button>
            <span className="scene-count muted" aria-label={`${scenes.length}개 중 ${index + 1}번째`}>{index + 1}/{scenes.length}</span>
          </div>
        )}
        {!many && <div className="scene-tabs" role="tablist" aria-label="장면" ref={tabStops.ref} onFocus={tabStops.onFocus} onKeyDown={onTabListKeyDown}>
          {scenes.map((s, i) => {
            const ind = dragId ? dropIndicator(scenes.findIndex((x) => x.id === dragId), overTab?.index ?? -1, overTab?.side ?? "before", scenes.length) : null;
            const mark = ind && ind.index === i ? ` drop-${ind.side}` : "";
            return (
              // 버튼은 드래그가 안 되는 브라우저가 있어서(파이어폭스) 바깥 칸이 끌려 간다. 키보드는 ◀ ▶ 단추로 같은 일을 한다.
              <span
                key={s.id}
                className={`scene-tab-wrap${dragId === s.id ? " dragging" : ""}${mark}`}
                data-testid="scene-tab-wrap"
                draggable={canReorder}
                title={canReorder ? "끌어서 순서를 바꿔요" : undefined}
                onDragStart={(e) => {
                  if (!canReorder) return;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", s.id); // 파이어폭스는 데이터가 있어야 끌기가 시작된다
                  setDragId(s.id);
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault(); // 여기에 놓을 수 있다는 표시
                  e.dataTransfer.dropEffect = "move";
                  const side = dropSide(e.clientX, e.currentTarget.getBoundingClientRect());
                  setOverTab((o) => (o && o.index === i && o.side === side ? o : { index: i, side }));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = scenes.findIndex((x) => x.id === dragId);
                  const to = reorderTarget(from, i, dropSide(e.clientX, e.currentTarget.getBoundingClientRect()), scenes.length);
                  if (dragId && to !== null) send({ type: "scene.reorder", data: { id: dragId, index: to } });
                  endDrag();
                }}
                onDragEnd={endDrag}
              >
                <button role="tab" aria-selected={s.id === viewId} className="scene-tab" ref={s.id === viewId ? viewTab : undefined} onClick={() => onView(s.id)}>
                  {s.id === activeId && <span aria-label="진행 중" title="지금 PL에게 보이는 장면" style={{ color: "var(--ok)" }}>● </span>}
                  {s.start && <span aria-label="시작 장면" title="세션을 시작하면 이 장면이 열려요">▶ </span>}
                  {s.name}
                </button>
              </span>
            );
          })}
        </div>}
        {many && <div className="spacer" />}
        {legend}
        <button type="button" className="btn sm scene-add" data-testid="scene-add" aria-label="새 장면 만들기" title="새 장면 만들기" disabled={!enabled || scenes.length >= MAX_SCENES} onClick={() => void newScene()}>＋</button>
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
          <Menu label="장면 설정" title="복제, 순서, 시작 지정, 배경, 배경음, 이름, 삭제" align="right">
            {(close) => (
              <>
                <MenuLabel>이 장면</MenuLabel>
                <button type="button" className="btn" data-testid="scene-duplicate" title="이 장면의 토큰·소품·안개·배경을 그대로 복사해요" disabled={!enabled || scenes.length >= MAX_SCENES} onClick={() => { duplicate(viewing.id); close(); }}><Copy aria-hidden />복제</button>
                <button type="button" className="btn" data-testid="scene-move-up" disabled={!enabled || index <= 0} onClick={() => { move(index - 1); close(); }}><ArrowLeft aria-hidden />앞으로 옮기기</button>
                <button type="button" className="btn" data-testid="scene-move-down" disabled={!enabled || index < 0 || index >= scenes.length - 1} onClick={() => { move(index + 1); close(); }}><ArrowRight aria-hidden />뒤로 옮기기</button>
                {settings(viewing, close)}
              </>
            )}
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

/** 장면이 많을 때: 이름으로 찾아 바로 고르는 목록 */
function SceneListMenu({ scenes, viewId, activeId, onView, label }: { scenes: readonly Scene[]; viewId: string; activeId: string; onView: (id: string) => void; label?: string }) {
  const [q, setQ] = useState("");
  const list = q.trim() ? scenes.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase())) : scenes;
  return (
    <Menu label={label ?? `목록 ${scenes.length}`} title="장면 목록에서 골라 열어요" align="left" testId="scene-list">
      {(close) => (
        <>
          {scenes.length > 8 && <input className="input" autoFocus aria-label="장면 찾기" placeholder="장면 이름 찾기" value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="scene-list" role="listbox" aria-label="장면 목록">
            {list.length === 0 && <div className="muted" style={{ padding: "6px 8px" }}>맞는 장면이 없어요.</div>}
            {list.map((s) => (
              <button key={s.id} type="button" role="option" aria-selected={s.id === viewId} className="btn scene-list-item" onClick={() => { onView(s.id); close(); }}>
                <span className="scene-list-mark" aria-hidden>{s.id === activeId ? "●" : s.start ? "▶" : ""}</span>
                <span className="scene-list-name">{s.name}</span>
                {s.id === viewId && <span aria-hidden className="select-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </Menu>
  );
}
