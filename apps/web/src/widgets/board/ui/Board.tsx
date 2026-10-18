"use client";
import { useEffect, useRef, useState } from "react";
import { STATUS_LABEL_KO, type BoardPing, type FogArea, type GameObject, type Role, type SceneGrid } from "@coc-vtt/shared";
import { imageUrl } from "@/shared/api";
import { dragHasFiles } from "@/shared/ui";
import { objectAt } from "../model/drop-target";
import {
  DEFAULT_CELL,
  FULL,
  H,
  MAX_ZOOM,
  W,
  centerOn,
  formatDistance,
  hitRadius,
  isFit,
  labelUnits,
  loadSnap,
  loadView,
  panBy,
  pinchView,
  pxPerUnit,
  saveSnap,
  saveView,
  screenToBoard,
  snapCorner,
  snapPoint,
  tokenScale,
  wheelFactor,
  zoomAt,
  zoomCenter,
  zoomLevel,
  type Frame,
  type Pt,
  type View,
} from "../model/view";
import { Pings } from "./Ping";

const R = 24;
/** 방향키 한 번에 움직이는 보드 단위(Shift는 잘게) */
export const KEY_STEP = 20;
export const KEY_STEP_FINE = 5;
/** 격자를 정하지 않은 장면에서 거리를 셀 때 쓰는 한 칸 */
const CELL = DEFAULT_CELL;
/** 길게 누르면 핑이 되는 시간(ms)과, 이만큼(화면 px) 움직이면 길게 누르기가 아니다 */
const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP = 10;

interface Props {
  objects: GameObject[];
  /** 장면 배경 이미지 id */
  background?: string;
  me: { userId: string; role: Role };
  canInteract: boolean;
  onMove: (obj: GameObject, x: number, y: number) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 안개. areas는 지금 보이는 원들이고, preview면 GM용으로 가려진 곳을 반투명하게 보여 준다. */
  fog?: { areas: FogArea[]; preview: boolean; /** 한 번이라도 보였던 곳: 지금 안 보여도 배경은 어둡게 보인다 */ explored?: FogArea[] };
  /** 켜 두면 빈 곳을 눌렀을 때 선택 대신 그 좌표를 알린다(영역 밝히기). */
  onPick?: (x: number, y: number) => void;
  /** 있으면 빈 곳·토큰을 길게 누르거나 Alt+클릭·더블클릭할 때 그 좌표를 알린다(핑). 지금 진행 중인 장면에서만 준다. */
  onPing?: (x: number, y: number) => void;
  /** 최근에 받은 핑과 지금 보는 장면. 그 장면의 핑만 그린다. */
  pings?: BoardPing[];
  sceneId?: string;
  /** 지금 차례인 토큰들(전투 중). 점선 링과 '차례' 라벨로 강조한다. */
  turnTokenIds?: string[];
  /** 끌기를 시작할 때(내가 움직일 수 있는 토큰) */
  onDragStart?: (obj: GameObject) => void;
  /** 끄면(움직임 줄이기) 핑 파동을 그리지 않고 고정된 고리만 보여 준다. */
  animate?: boolean;
  /** 있으면 이미지 파일을 보드에 끌어다 놓을 수 있다. hit은 놓은 자리의 오브젝트(없으면 null)와 보드·화면 좌표. */
  onImageFile?: (file: File, hit: { objectId: string | null; x: number; y: number; cx: number; cy: number }) => void;
  /** 있으면 오브젝트를 오른쪽 클릭하거나(터치는 길게 누르면) 이 메뉴를 연다. */
  onObjectMenu?: (obj: GameObject, cx: number, cy: number) => void;
  /** 있으면 이미지 없는 선택 오브젝트 아래에 '이미지 올리기' 칩을 보여 준다. */
  onRequestImage?: (obj: GameObject, cx: number, cy: number) => void;
  /** 보드 위에 한 줄로 띄우는 안내(예: 배경이 비었을 때) */
  hint?: string;
  /** 시트가 이어진 토큰을 (끌지 않고) 눌렀을 때. 열 수 있는 사람인지는 부르는 쪽이 정한다. */
  onOpenSheet?: (obj: GameObject) => void;
  /** 장면의 격자. 보이기·칸 맞추기 설정이 들어 있다. */
  grid?: SceneGrid;
  /** 확대·이동을 이 브라우저에 기억할 때 쓰는 키(사람·룸·장면마다 다르다). 없으면 기억하지 않는다. */
  viewKey?: string;
  /** 격자 맞춤을 이 사람이 따로 정한 값의 키 */
  snapKey?: string;
}

export function Board({ objects, background, me, canInteract, onMove, selectedId, onSelect, fog, onPick, onPing, pings, sceneId, turnTokenIds, onDragStart, animate = true, onImageFile, onObjectMenu, onRequestImage, hint, onOpenSheet, grid, viewKey, snapKey }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [view, setView] = useState<View>(FULL);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const pan = useRef<{ px: number; py: number; v: View } | null>(null);
  const kbTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [fileOver, setFileOver] = useState<{ id: string | null } | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; cx: number; cy: number } | null>(null);
  // 화면에 닿아 있는 손가락(포인터)들과, 두 손가락 확대 중의 시작 상태
  const pts = useRef(new Map<number, Pt>());
  const pinch = useRef<{ start: View; ids: [number, number]; p: [Pt, Pt] } | null>(null);
  // 자(거리 재기): 이 화면에만 그리고 저장하지 않는다
  const [rulerOn, setRulerOn] = useState(false);
  const [ruler, setRuler] = useState<{ a: Pt; b: Pt } | null>(null);
  const rulerDrag = useRef(false);
  // 격자 맞춤: 장면 설정이 기본이고, 이 사람이 따로 켜거나 끈 값이 있으면 그 값을 쓴다
  const [snapPref, setSnapPref] = useState<boolean | null>(null);
  useEffect(() => setSnapPref(snapKey ? loadSnap(snapKey) : null), [snapKey]);
  const snapOn = Boolean(grid) && (snapPref ?? grid!.snap);
  const cell = grid?.size ?? CELL;

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);
  // 토큰을 눌렀다 떼면(거의 움직이지 않고 짧게) 이어진 시트를 연다.
  const tap = useRef<{ id: string; cx: number; cy: number; at: number } | null>(null);

  // 보드 요소의 크기를 지켜본다(이름표·토큰 크기를 화면 배율에 맞추는 데 쓴다).
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const read = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const frame = (): Frame => {
    const r = svg.current!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  const scale = pxPerUnit(view, size); // 보드 1단위가 화면 몇 px인지
  const labelFs = labelUnits(12, scale);
  const kt = tokenScale(R * 2, scale);
  const hitR = hitRadius(44, scale);

  /** 길게 누르면 그 자리를 핑한다. 많이 움직이거나 손을 떼면 취소된다. */
  const startPress = (e: React.PointerEvent, obj?: GameObject) => {
    cancelPress();
    // 터치로 오브젝트를 길게 누르면 핑 대신 메뉴(오른쪽 클릭 대신). 마우스의 길게 누르기는 그대로 핑이다.
    if (obj && onObjectMenu && e.pointerType !== "mouse") {
      const { clientX: cx, clientY: cy } = e;
      press.current = { cx, cy, timer: setTimeout(() => { press.current = null; tap.current = null; setDrag(null); onObjectMenu(obj, cx, cy); }, LONG_PRESS_MS) };
      return;
    }
    if (!onPing || onPick) return;
    const p = toBoard(e);
    press.current = { cx: e.clientX, cy: e.clientY, timer: setTimeout(() => { press.current = null; onPing(Math.round(p.x), Math.round(p.y)); }, LONG_PRESS_MS) };
  };
  const zoomed = !isFit(view);
  const mineToken = objects.find((o) => o.kind === "token" && o.ownerId === me.userId);

  // 장면이 바뀌면 그 장면에서 마지막으로 보던 보기를 되살리고, 없으면 맞춤으로 돌아간다.
  const sceneKey = objects[0]?.sceneId ?? background ?? "";
  const scopeKey = viewKey ?? sceneKey;
  useEffect(() => {
    setView((viewKey && loadView(viewKey)) || FULL);
    setRuler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  // 바뀐 보기를 잠깐 뒤에 기억한다(끌고 있는 동안 매번 쓰지 않는다).
  useEffect(() => {
    if (!viewKey) return;
    const t = setTimeout(() => saveView(viewKey, view), 250);
    return () => clearTimeout(t);
  }, [view, viewKey]);

  const zoomBy = (factor: number) => setView((v) => zoomCenter(v, frame(), factor));
  const fit = () => setView(FULL);
  const focusMine = () => mineToken && setView((v) => centerOn(v, mineToken, Math.max(zoomLevel(v), 2)));
  const toggleSnap = () => {
    const next = !snapOn;
    setSnapPref(next);
    if (snapKey) saveSnap(snapKey, next);
  };
  const toggleRuler = () => {
    setRulerOn((on) => !on);
    setRuler(null);
    rulerDrag.current = false;
  };

  // 휠: 커서 아래를 기준으로 확대·축소. 안 막으면 Ctrl+휠이 페이지 확대로 새어 나가므로 막을 수 있는 리스너로 단다.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey);
      const r = el.getBoundingClientRect();
      setView((v) => zoomAt(v, { left: r.left, top: r.top, width: r.width, height: r.height }, f, e.clientX, e.clientY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const canMove = (o: GameObject) =>
    canInteract && me.role !== "spectator" && (me.role === "kp" || (o.ownerId === me.userId && !o.locked));

  const toBoard = (e: { clientX: number; clientY: number }) => screenToBoard(view, frame(), e.clientX, e.clientY);
  const place = (p: Pt) => (snapOn ? snapPoint(p, cell) : p);

  return (
    <>
    <svg
      ref={svg}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="application"
      aria-label="게임 보드. 토큰을 고르고 방향키로 움직일 수 있어요. + − 키로 확대·축소하고, 0 키로 맞춰 봐요. P 키나 길게 누르기로 모두에게 가리킬 수 있어요. 고른 토큰이 있으면 Tab으로 다음 토큰을 고르고, Esc로 선택을 풀어요. 물음표 키로 단축키를 볼 수 있어요."
      aria-keyshortcuts="+ - 0 P ArrowUp ArrowDown ArrowLeft ArrowRight Tab Escape ?"
      tabIndex={0}
      id="game-board"
      data-testid="board"
      data-zoom={zoomLevel(view).toFixed(2)}
      data-ruler={rulerOn ? "on" : undefined}
      data-snap={snapOn ? "on" : undefined}
      onKeyDown={(e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === "+" || e.key === "=") return void zoomBy(1.25);
        if (e.key === "-" || e.key === "_") return void zoomBy(0.8);
        if (e.key === "0") return void fit();
        if (e.key === "Escape" && (rulerOn || ruler)) {
          setRuler(null);
          return void setRulerOn(false);
        }
        if ((e.key === "p" || e.key === "P") && onPing) {
          const sel = objects.find((x) => x.id === selectedId);
          return void (sel && onPing(Math.round(sel.x), Math.round(sel.y)));
        }
        const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!dir) return;
        const o = objects.find((x) => x.id === selectedId);
        if (!o || !canMove(o)) return;
        e.preventDefault();
        // 격자 맞춤이 켜져 있으면 한 칸씩, 아니면 20단위씩. Shift는 5단위로 잘게(맞추지 않음).
        const fine = e.shiftKey;
        const step = fine ? KEY_STEP_FINE : snapOn ? cell : KEY_STEP;
        const cur = drag?.id === o.id ? drag : { id: o.id, x: o.x, y: o.y };
        const raw = { x: Math.max(0, Math.min(W, cur.x + dir[0]! * step)), y: Math.max(0, Math.min(H, cur.y + dir[1]! * step)) };
        const to = fine ? raw : place(raw);
        const next = { id: o.id, x: to.x, y: to.y };
        setDrag(next);
        // 키를 멈추면 한 번에 서버로 보낸다(연타가 오래된 위치 거절을 부르지 않게).
        clearTimeout(kbTimer.current);
        kbTimer.current = setTimeout(() => {
          onMove(o, Math.round(next.x), Math.round(next.y));
          setDrag(null);
          kbTimer.current = undefined;
        }, 350);
      }}
      onContextMenu={(e) => (onPing || onObjectMenu) && e.preventDefault()}
      onDragEnter={(e) => {
        if (onImageFile && dragHasFiles(e)) setFileOver({ id: null });
      }}
      onDragOver={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault(); // 안 막으면 놓았을 때 브라우저가 그림 파일을 열어 버린다
        if (!onImageFile) return;
        e.dataTransfer.dropEffect = "copy";
        const p = toBoard(e);
        const id = objectAt(objects, p.x, p.y);
        setFileOver((cur) => (cur && cur.id === id ? cur : { id }));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileOver(null);
      }}
      onDrop={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        setFileOver(null);
        if (!onImageFile) return;
        const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/")) ?? e.dataTransfer.files[0];
        if (!file) return;
        const p = toBoard(e);
        onImageFile(file, { objectId: objectAt(objects, p.x, p.y), x: Math.round(p.x), y: Math.round(p.y), cx: e.clientX, cy: e.clientY });
      }}
      onDoubleClick={(e) => {
        if (!onPing || onPick || rulerOn) return;
        if (e.target !== svg.current && (e.target as Element).getAttribute("data-bg") === null) return;
        const p = toBoard(e as unknown as React.PointerEvent);
        onPing(Math.round(p.x), Math.round(p.y));
      }}
      onPointerDownCapture={(e) => {
        // 토큰이든 빈 곳이든, 손가락이 둘이 되면 두 손가락 확대를 시작한다(끌던 것은 멈춘다).
        // 첫 손가락(primary)이 닿으면 이전 기록은 모두 낡은 것이다(떼는 이벤트를 놓친 경우를 대비)
        if (e.isPrimary) {
          pts.current.clear();
          pinch.current = null;
        }
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.current.size >= 2 && !pinch.current) {
          const [a, b] = [...pts.current.entries()];
          cancelPress();
          pan.current = null;
          tap.current = null;
          rulerDrag.current = false;
          setDrag(null);
          pinch.current = { start: view, ids: [a![0], b![0]], p: [a![1], b![1]] };
        }
      }}
      onPointerDown={(e) => {
        if (pinch.current) return;
        if (rulerOn) {
          // 자: 눌러서 끌면 그 사이 거리를 보여 준다
          const p = toBoard(e);
          const a = snapOn ? snapCorner(p, cell) : p;
          setRuler({ a, b: a });
          rulerDrag.current = true;
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          return;
        }
        if (e.target !== svg.current && (e.target as Element).getAttribute("data-bg") === null) return;
        if (e.altKey && onPing && !onPick) {
          const p = toBoard(e);
          onPing(Math.round(p.x), Math.round(p.y));
          return;
        }
        startPress(e);
        if (onPick) {
          const p = toBoard(e);
          onPick(Math.round(p.x), Math.round(p.y));
          return;
        }
        onSelect(null);
        // 빈 곳을 끌면 보기를 옮긴다(안개 영역 고르기 같은 도구를 켜 두었을 때는 위에서 이미 빠져나갔다).
        if (zoomed) {
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          pan.current = { px: e.clientX, py: e.clientY, v: view };
        }
      }}
      onPointerMove={(e) => {
        if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const pc = pinch.current;
        if (pc) {
          const a = pts.current.get(pc.ids[0]);
          const b = pts.current.get(pc.ids[1]);
          if (a && b) setView(pinchView(pc.start, frame(), pc.p, [a, b]));
          return;
        }
        if (press.current && Math.hypot(e.clientX - press.current.cx, e.clientY - press.current.cy) > LONG_PRESS_SLOP) cancelPress();
        if (rulerDrag.current) {
          const p = toBoard(e);
          setRuler((r) => (r ? { a: r.a, b: snapOn ? snapCorner(p, cell) : p } : r));
          return;
        }
        if (pan.current) {
          const el = svg.current!;
          setView(panBy(pan.current.v, { width: el.clientWidth, height: el.clientHeight }, e.clientX - pan.current.px, e.clientY - pan.current.py));
          return;
        }
        if (drag && e.buttons) setDrag({ ...drag, ...place(toBoard(e)) });
      }}
      onPointerCancel={(e) => {
        cancelPress();
        pts.current.delete(e.pointerId);
        if (pinch.current?.ids.includes(e.pointerId)) pinch.current = null;
        pan.current = null;
        rulerDrag.current = false;
        setDrag(null);
      }}
      onPointerUp={(e) => {
        cancelPress();
        pts.current.delete(e.pointerId);
        if (pinch.current) {
          // 한 손가락을 떼면 확대는 끝이다. 남은 손가락은 다시 눌러야 끌기가 된다.
          if (pinch.current.ids.includes(e.pointerId)) pinch.current = null;
          return;
        }
        if (rulerDrag.current) {
          rulerDrag.current = false;
          return;
        }
        const t = tap.current;
        tap.current = null;
        if (t && onOpenSheet && Math.hypot(e.clientX - t.cx, e.clientY - t.cy) < 6 && Date.now() - t.at < LONG_PRESS_MS) {
          const o = objects.find((x) => x.id === t.id);
          if (o?.characterId) onOpenSheet(o);
        }
        if (pan.current) {
          pan.current = null;
          return;
        }
        if (!drag) return;
        const o = objects.find((x) => x.id === drag.id);
        if (o && (o.x !== drag.x || o.y !== drag.y)) onMove(o, Math.round(drag.x), Math.round(drag.y));
        setDrag(null);
      }}
      style={{ display: "block", touchAction: "none" }}
    >
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="#1a1d22" strokeWidth="1" />
        </pattern>
        {grid?.show && (
          <pattern id="grid-user" width={grid.size} height={grid.size} patternUnits="userSpaceOnUse">
            <path d={`M${grid.size} 0H0V${grid.size}`} fill="none" stroke="rgba(190,200,230,.28)" strokeWidth={Math.max(1, 1 / scale)} />
          </pattern>
        )}
      </defs>
      {background && <image href={imageUrl(background)} width={W} height={H} preserveAspectRatio="xMidYMid meet" data-testid="board-bg" pointerEvents="none" />}
      {(!grid || grid.show) && <rect width={W} height={H} fill={grid?.show ? "url(#grid-user)" : "url(#grid)"} pointerEvents="none" data-testid={grid?.show ? "board-grid" : undefined} />}
      <rect data-bg="" width={W} height={H} fill="transparent" />
      {fog && (
        <g data-testid="fog" data-areas={fog.areas.length} pointerEvents="none">
          <mask id="fog-mask">
            <rect width={W} height={H} fill="white" />
            {(fog.preview ? fog.areas : [...fog.areas, ...(fog.explored ?? [])]).map((a, i) => (
              <circle key={i} cx={a.x} cy={a.y} r={a.r} fill="black" />
            ))}
          </mask>
          <rect width={W} height={H} fill="#000" opacity={fog.preview ? 0.55 : 1} mask="url(#fog-mask)" />
          {!fog.preview && !!fog.explored?.length && (
            <>
              <mask id="fog-mask-now">
                <rect width={W} height={H} fill="white" />
                {fog.areas.map((a, i) => (
                  <circle key={i} cx={a.x} cy={a.y} r={a.r} fill="black" />
                ))}
              </mask>
              <rect width={W} height={H} fill="#000" opacity={0.55} mask="url(#fog-mask-now)" data-testid="fog-explored" data-count={fog.explored.length} />
            </>
          )}
          {fog.preview && fog.areas.map((a, i) => <circle key={i} cx={a.x} cy={a.y} r={a.r} fill="none" stroke="#7c86f7" strokeWidth="1.5" strokeDasharray="6 5" opacity="0.8" />)}
          {fog.preview && fog.explored?.map((a, i) => <circle key={`e${i}`} cx={a.x} cy={a.y} r={a.r} fill="none" stroke="#e3a94a" strokeWidth="1" strokeDasharray="2 6" opacity="0.5" data-testid="fog-explored-ring" />)}
        </g>
      )}
      {objects.map((o) => {
        const pos = drag?.id === o.id ? drag : o;
        const hidden = o.layer === "gm" || o.visibleTo === "gm";
        const mine = o.kind === "token" && me.role === "pl" && o.ownerId === me.userId;
        const stroke = hidden ? "#e3a94a" : mine ? "#4cc38a" : o.kind === "token" ? "#b8c7ff" : "#6b727c";
        const fill = hidden ? "rgba(227,169,74,.12)" : o.kind === "token" ? "#2b3a5e" : "#23272d";
        // 몸통(링·배지·막대 포함)은 많이 축소했을 때만 커진다. 이름표는 따로 화면 글자 크기를 지킨다.
        const body = kt === 1 ? undefined : `translate(${pos.x} ${pos.y}) scale(${kt}) translate(${-pos.x} ${-pos.y})`;
        const labelY = pos.y + kt * (o.kind === "token" ? R + 8 : o.image ? 40 : 22) + labelFs * 0.95;
        const desc = `${o.name}${mine ? ", 내 토큰" : ""}${hidden ? ", GM 전용" : ""}${o.locked ? ", 잠김" : ""}, 위치 ${Math.round(pos.x)} ${Math.round(pos.y)}`;
        return (
          <g
            key={o.id}
            data-testid={`obj-${o.name}`}
            data-x={Math.round(pos.x)}
            data-y={Math.round(pos.y)}
            data-mine={mine ? "true" : undefined}
            data-locked={o.locked ? "true" : undefined}
            data-linked={o.characterId ? "true" : undefined}
            role="img"
            aria-label={desc}
            style={{ cursor: rulerOn ? "crosshair" : canMove(o) ? "grab" : o.characterId && onOpenSheet ? "pointer" : "default" }}
            onContextMenu={(e) => {
              if (!onObjectMenu) return;
              e.preventDefault(); // 메뉴는 pointerdown 에서 이미 열었다
              e.stopPropagation();
            }}
            onPointerDown={(e) => {
              if (rulerOn) return; // 자를 켜 두면 토큰 위에서도 재기가 시작된다
              e.stopPropagation();
              if (pinch.current) return;
              if (e.button === 2) {
                // 오른쪽 클릭: 고르면서 바로 메뉴를 연다. 고르면 아래 도구 줄이 생겨 보드 크기가 바뀌므로, contextmenu 때는 이미 토큰이 비켜 있을 수 있다.
                onSelect(o.id);
                onObjectMenu?.(o, e.clientX, e.clientY);
                return;
              }
              if (e.altKey && onPing && !onPick) {
                const p = toBoard(e);
                return void onPing(Math.round(p.x), Math.round(p.y));
              }
              startPress(e, o);
              tap.current = o.characterId && onOpenSheet ? { id: o.id, cx: e.clientX, cy: e.clientY, at: Date.now() } : null;
              onSelect(o.id);
              if (canMove(o)) {
                onDragStart?.(o);
                (e.currentTarget as SVGGElement).ownerSVGElement?.setPointerCapture(e.pointerId);
                setDrag({ id: o.id, x: o.x, y: o.y });
              }
            }}
          >
            <circle className="tok-hit" cx={pos.x} cy={pos.y} r={hitR} />
            <g transform={body}>
            {mine && <circle cx={pos.x} cy={pos.y} r={R + 5} fill="none" stroke="#4cc38a" strokeWidth="1.5" opacity="0.55" data-testid="mine-ring" pointerEvents="none" />}
            {turnTokenIds?.includes(o.id) && (
              <g pointerEvents="none" data-testid="turn-ring">
                <circle cx={pos.x} cy={pos.y} r={R + 13} fill="none" stroke="#f0b429" strokeWidth="2.5" strokeDasharray="5 4" />
                <rect x={pos.x - 20} y={pos.y + R + 24} width="40" height="16" rx="8" fill="#f0b429" />
                <text x={pos.x} y={pos.y + R + 36} textAnchor="middle" fill="#08090a" fontSize="11" fontWeight="700">차례</text>
              </g>
            )}
            {selectedId === o.id && <circle cx={pos.x} cy={pos.y} r={R + 8} fill="none" stroke="#7c86f7" strokeWidth="2" />}
            {fileOver?.id === o.id && <circle cx={pos.x} cy={pos.y} r={R + 10} fill="rgba(124,134,247,.18)" stroke="#7c86f7" strokeWidth="2.5" strokeDasharray="4 3" pointerEvents="none" data-testid="drop-target" />}
            {o.image ? (
              <>
                <clipPath id={`clip-${o.id}`}>
                  {o.kind === "token" ? <circle cx={pos.x} cy={pos.y} r={R} /> : <rect x={pos.x - 32} y={pos.y - 32} width="64" height="64" rx="6" />}
                </clipPath>
                <image href={imageUrl(o.image)} x={pos.x - (o.kind === "token" ? R : 32)} y={pos.y - (o.kind === "token" ? R : 32)} width={o.kind === "token" ? R * 2 : 64} height={o.kind === "token" ? R * 2 : 64} preserveAspectRatio="xMidYMid slice" clipPath={`url(#clip-${o.id})`} data-testid={`img-${o.name}`} />
                {o.kind === "token" ? (
                  <circle cx={pos.x} cy={pos.y} r={R} fill="none" stroke={stroke} strokeWidth="2" strokeDasharray={hidden ? "5 4" : undefined} />
                ) : (
                  <rect x={pos.x - 32} y={pos.y - 32} width="64" height="64" rx="6" fill="none" stroke={stroke} strokeWidth="2" strokeDasharray={hidden ? "5 4" : undefined} />
                )}
              </>
            ) : o.kind === "token" ? (
              <circle cx={pos.x} cy={pos.y} r={R} fill={fill} stroke={stroke} strokeWidth="2" strokeDasharray={hidden ? "5 4" : undefined} />
            ) : (
              <rect x={pos.x - 36} y={pos.y - 14} width="72" height="28" rx="5" fill={fill} stroke={stroke} strokeWidth="2" strokeDasharray={hidden ? "5 4" : undefined} />
            )}
            {!o.image && (
              <text x={pos.x} y={pos.y + 5} textAnchor="middle" fill="#e7e9ec" fontSize="14" fontWeight="600" pointerEvents="none">
                {o.name.slice(0, 1)}
              </text>
            )}
            {o.kind === "token" && o.vitals && <TokenVitalsBar name={o.name} vitals={o.vitals} x={pos.x} y={pos.y} />}
            {mine && (
              <g pointerEvents="none" data-testid="mine-badge">
                <rect x={pos.x + R - 12} y={pos.y - R - 6} width="22" height="16" rx="8" fill="#4cc38a" />
                <text x={pos.x + R - 1} y={pos.y - R + 6} textAnchor="middle" fill="#08090a" fontSize="11" fontWeight="700">나</text>
              </g>
            )}
            </g>
            <text x={pos.x} y={labelY} textAnchor="middle" fill={hidden ? "#e3a94a" : "#c3c9d2"} fontSize={labelFs} pointerEvents="none" stroke="#0a0b0d" strokeWidth={(3.5 * labelFs) / 12} strokeLinejoin="round" paintOrder="stroke" data-testid={`label-${o.name}`}>
              {o.name}
              {hidden ? " · GM 전용" : ""}
              {o.locked ? " · 잠김" : ""}
            </text>
            {selectedId === o.id && !o.image && onRequestImage && drag?.id !== o.id && (
              <g
                data-testid="add-image-chip"
                transform={`translate(${pos.x} ${labelY + 8}) scale(${labelFs / 12})`}
                style={{ cursor: "pointer" }}
                aria-hidden
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => onRequestImage(o, e.clientX, e.clientY)}
              >
                <rect x={-38} y={0} width="76" height="18" rx="9" fill="#1a1b1e" stroke="#7c86f7" strokeWidth="1" />
                <text x={0} y={13} textAnchor="middle" fill="#b8c7ff" fontSize="11" fontWeight="600" pointerEvents="none">이미지 올리기</text>
              </g>
            )}
            {drag?.id === o.id && Math.hypot(drag.x - o.x, drag.y - o.y) >= cell / 8 && (
              <g pointerEvents="none" data-testid="move-dist">
                <line x1={o.x} y1={o.y} x2={drag.x} y2={drag.y} stroke="#b8c7ff" strokeWidth={Math.max(1.5, 1.5 / scale)} strokeDasharray="4 4" opacity="0.7" />
                <circle cx={o.x} cy={o.y} r={3} fill="#b8c7ff" opacity="0.7" />
                <text x={drag.x + R * kt + 10} y={drag.y + 5} fill="#e7e9ec" fontSize={labelUnits(14, scale)} fontWeight="600" stroke="#08090a" strokeWidth={(3 * labelUnits(14, scale)) / 14} paintOrder="stroke">
                  {(Math.hypot(drag.x - o.x, drag.y - o.y) / cell).toFixed(1)}칸
                </text>
              </g>
            )}
          </g>
        );
      })}
      {ruler && (
        <g pointerEvents="none" data-testid="ruler" data-a={`${Math.round(ruler.a.x)},${Math.round(ruler.a.y)}`} data-b={`${Math.round(ruler.b.x)},${Math.round(ruler.b.y)}`}>
          <line x1={ruler.a.x} y1={ruler.a.y} x2={ruler.b.x} y2={ruler.b.y} stroke="#f0b429" strokeWidth={Math.max(2, 2 / scale)} strokeLinecap="round" />
          <circle cx={ruler.a.x} cy={ruler.a.y} r={Math.max(4, 5 / scale)} fill="#f0b429" stroke="#08090a" strokeWidth="1" />
          <circle cx={ruler.b.x} cy={ruler.b.y} r={Math.max(4, 5 / scale)} fill="#f0b429" stroke="#08090a" strokeWidth="1" />
          <text x={(ruler.a.x + ruler.b.x) / 2} y={(ruler.a.y + ruler.b.y) / 2 - labelUnits(10, scale)} textAnchor="middle" fill="#ffe39a" fontSize={labelUnits(14, scale)} fontWeight="700" stroke="#08090a" strokeWidth={(3.5 * labelUnits(14, scale)) / 14} paintOrder="stroke" data-testid="ruler-label">
            {formatDistance(ruler.a, ruler.b, cell)}
          </text>
        </g>
      )}
      {hint && !fileOver && (
        <g data-testid="board-hint" pointerEvents="none">
          <rect x={W / 2 - 150} y={H - 52} width="300" height="28" rx="14" fill="rgba(14,15,17,.88)" stroke="#6b727c" strokeDasharray="4 4" />
          <text x={W / 2} y={H - 33} textAnchor="middle" fill="#b4b7bf" fontSize="14">{hint}</text>
        </g>
      )}
      {pings && sceneId !== undefined && <Pings pings={pings} sceneId={sceneId} animate={animate} />}
    </svg>
    <ul className="sr-only" aria-label="보드 위 토큰 목록" data-testid="board-token-list">
      {objects.map((o) => (
        <li key={o.id}>
          <button
            type="button"
            aria-pressed={selectedId === o.id}
            data-testid={`pick-${o.name}`}
            onClick={() => {
              onSelect(o.id);
              svg.current?.focus();
            }}
          >
            {o.name}
            {o.kind === "token" && o.ownerId === me.userId ? " (내 토큰)" : ""}
            {o.layer === "gm" || o.visibleTo === "gm" ? " (GM 전용)" : ""}
            {canMove(o) ? "" : " (움직일 수 없음)"}
          </button>
        </li>
      ))}
    </ul>
    {fileOver && onImageFile && <div className="drop-veil" data-testid="drop-veil" aria-hidden>{fileOver.id ? "이 토큰의 이미지로 넣어요" : "놓으면 쓰임을 물어봐요"}</div>}
    <div className="zoom-ctl" role="group" aria-label="보드 확대·이동" data-testid="zoom-ctl">
      <button type="button" className="btn sm zc" aria-label="확대" title="확대 (+)" onClick={() => zoomBy(1.25)} disabled={view.w <= W / MAX_ZOOM + 0.5}>＋</button>
      <button type="button" className="btn sm zc" aria-label="축소" title="축소 (-)" onClick={() => zoomBy(0.8)} disabled={!zoomed}>－</button>
      <button type="button" className="btn sm zc" data-testid="zoom-fit" title="보드 전체가 보이게 맞춰요 (0)" onClick={fit} disabled={!zoomed}>맞춤</button>
      {mineToken && <button type="button" className="btn sm zc" data-testid="focus-mine" title="내 토큰이 가운데 오게 해요" onClick={focusMine}>내 토큰</button>}
      <button type="button" className="btn sm zc" data-testid="ruler-toggle" aria-pressed={rulerOn} title="보드를 끌어서 두 곳 사이의 거리를 재요. 나에게만 보여요" onClick={toggleRuler}>자</button>
      {grid && <button type="button" className="btn sm zc" data-testid="snap-toggle" aria-pressed={snapOn} title="켜면 토큰이 칸 가운데로 맞춰져요" onClick={toggleSnap}>칸 맞춤</button>}
    </div>
    </>
  );
}

const STATUS_COLOR: Record<string, string> = { injured: "#e3a94a", majorWound: "#e07a3f", unconscious: "#8a93a6", dying: "#d9534f", dead: "#6b727c" };
/** 칩에는 가장 무거운 상태 하나만 보인다. */
const STATUS_ORDER = ["dead", "dying", "unconscious", "majorWound", "injured"] as const;

/** 토큰 아래의 얇은 HP 막대와 왼쪽 위의 상태 칩. 서버가 보여도 되는 사람에게만 vitals를 보낸다. */
function TokenVitalsBar({ name, vitals, x, y }: { name: string; vitals: NonNullable<GameObject["vitals"]>; x: number; y: number }) {
  const ratio = vitals.max > 0 ? Math.max(0, Math.min(1, vitals.hp / vitals.max)) : 0;
  const color = ratio > 0.5 ? "#4cc38a" : ratio > 0.25 ? "#e3a94a" : "#d9534f";
  const status = STATUS_ORDER.find((k) => vitals.status?.includes(k));
  const w = R * 2;
  return (
    <g pointerEvents="none" data-testid={`hp-${name}`} data-hp={vitals.hp} data-max={vitals.max} data-status={vitals.status?.join(",") || undefined} aria-hidden>
      <rect x={x - R} y={y + R + 3} width={w} height={4} rx={2} fill="#0a0b0d" stroke="#3a3f47" strokeWidth="0.75" />
      <rect x={x - R} y={y + R + 3} width={w * ratio} height={4} rx={2} fill={color} />
      {status && (
        <g data-testid={`status-${name}`}>
          <rect x={x - R - 14} y={y - R - 6} width={34} height={16} rx={8} fill={STATUS_COLOR[status] ?? "#6b727c"} />
          <text x={x - R + 3} y={y - R + 6} textAnchor="middle" fill="#08090a" fontSize="11" fontWeight="700">{STATUS_LABEL_KO[status]}</text>
        </g>
      )}
    </g>
  );
}
