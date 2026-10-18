"use client";
import { useEffect, useRef, useState } from "react";
import type { BoardPing, FogArea, GameObject, Role } from "@coc-vtt/shared";
import { imageUrl } from "@/shared/api";
import { Pings } from "./Ping";

const W = 1000;
const H = 800;
const R = 24;
const MAX_ZOOM = 4;
const KEY_STEP = 10;
/** 격자 한 칸의 보드 단위 */
const CELL = 40;
/** 길게 누르면 핑이 되는 시간(ms)과, 이만큼(화면 px) 움직이면 길게 누르기가 아니다 */
const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP = 10;

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}
const FULL: View = { x: 0, y: 0, w: W, h: H };

/** 보기 영역을 보드 안에 가둔다. */
const clampView = (v: View): View => {
  const w = Math.min(W, Math.max(W / MAX_ZOOM, v.w));
  const h = (w * H) / W;
  return { w, h, x: Math.max(0, Math.min(W - w, v.x)), y: Math.max(0, Math.min(H - h, v.y)) };
};

interface Props {
  objects: GameObject[];
  /** 장면 배경 이미지 id */
  background?: string;
  me: { userId: string; role: Role };
  canInteract: boolean;
  onMove: (obj: GameObject, x: number, y: number) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 안개. areas는 지금 보이는 원들이고, preview면 KP용으로 가려진 곳을 반투명하게 보여 준다. */
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
}

export function Board({ objects, background, me, canInteract, onMove, selectedId, onSelect, fog, onPick, onPing, pings, sceneId, turnTokenIds, onDragStart, animate = true }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [view, setView] = useState<View>(FULL);
  const pan = useRef<{ px: number; py: number; v: View } | null>(null);
  const kbTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; cx: number; cy: number } | null>(null);
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);
  /** 길게 누르면 그 자리를 핑한다. 많이 움직이거나 손을 떼면 취소된다. */
  const startPress = (e: React.PointerEvent) => {
    cancelPress();
    if (!onPing || onPick) return;
    const p = toBoard(e);
    press.current = { cx: e.clientX, cy: e.clientY, timer: setTimeout(() => { press.current = null; onPing(Math.round(p.x), Math.round(p.y)); }, LONG_PRESS_MS) };
  };
  const zoomed = view.w < W;
  const mineToken = objects.find((o) => o.kind === "token" && o.ownerId === me.userId);

  // 장면이 바뀌면(보이는 오브젝트의 장면이 달라지면) 전체 보기로 돌아간다.
  const sceneKey = objects[0]?.sceneId ?? background ?? "";
  useEffect(() => setView(FULL), [sceneKey]);

  const zoomAt = (factor: number, cx = view.x + view.w / 2, cy = view.y + view.h / 2) => {
    const w = Math.min(W, Math.max(W / MAX_ZOOM, view.w / factor));
    const k = w / view.w;
    setView(clampView({ x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k, w, h: (w * H) / W }));
  };
  const centerOn = (x: number, y: number) => {
    const w = Math.min(view.w, W / 2);
    setView(clampView({ x: x - w / 2, y: y - (w * H) / W / 2, w, h: (w * H) / W }));
  };

  const canMove = (o: GameObject) =>
    canInteract && me.role !== "spectator" && (me.role === "kp" || (o.ownerId === me.userId && !o.locked));

  const toBoard = (e: React.PointerEvent) => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(el.getScreenCTM()!.inverse());
    return { x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, p.y)) };
  };

  return (
    <>
    <svg
      ref={svg}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="application"
      aria-label="게임 보드. 토큰을 고르고 방향키로 움직일 수 있어요. + − 키로 확대·축소하고, P 키나 길게 누르기로 모두에게 가리킬 수 있어요."
      tabIndex={0}
      id="game-board"
      data-testid="board"
      onWheel={(e) => {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) return;
        const p = toBoard(e as unknown as React.PointerEvent);
        zoomAt(e.deltaY < 0 ? 1.25 : 0.8, p.x, p.y);
      }}
      onKeyDown={(e) => {
        if (e.key === "+" || e.key === "=") return void zoomAt(1.25);
        if (e.key === "-" || e.key === "_") return void zoomAt(0.8);
        if (e.key === "0") return void setView(FULL);
        if ((e.key === "p" || e.key === "P") && onPing) {
          const sel = objects.find((x) => x.id === selectedId);
          return void (sel && onPing(Math.round(sel.x), Math.round(sel.y)));
        }
        const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!dir) return;
        const o = objects.find((x) => x.id === selectedId);
        if (!o || !canMove(o)) return;
        e.preventDefault();
        const step = e.shiftKey ? KEY_STEP * 5 : KEY_STEP;
        const cur = drag?.id === o.id ? drag : { id: o.id, x: o.x, y: o.y };
        const next = { id: o.id, x: Math.max(0, Math.min(W, cur.x + dir[0]! * step)), y: Math.max(0, Math.min(H, cur.y + dir[1]! * step)) };
        setDrag(next);
        // 키를 멈추면 한 번에 서버로 보낸다(연타가 오래된 위치 거절을 부르지 않게).
        clearTimeout(kbTimer.current);
        kbTimer.current = setTimeout(() => {
          onMove(o, Math.round(next.x), Math.round(next.y));
          setDrag(null);
          kbTimer.current = undefined;
        }, 350);
      }}
      onContextMenu={(e) => onPing && e.preventDefault()}
      onDoubleClick={(e) => {
        if (!onPing || onPick) return;
        if (e.target !== svg.current && (e.target as Element).getAttribute("data-bg") === null) return;
        const p = toBoard(e as unknown as React.PointerEvent);
        onPing(Math.round(p.x), Math.round(p.y));
      }}
      onPointerDown={(e) => {
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
        if (zoomed) {
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          pan.current = { px: e.clientX, py: e.clientY, v: view };
        }
      }}
      onPointerMove={(e) => {
        if (press.current && Math.hypot(e.clientX - press.current.cx, e.clientY - press.current.cy) > LONG_PRESS_SLOP) cancelPress();
        if (pan.current) {
          const el = svg.current!;
          const scale = Math.min(el.clientWidth / pan.current.v.w, el.clientHeight / pan.current.v.h);
          setView(clampView({ ...pan.current.v, x: pan.current.v.x - (e.clientX - pan.current.px) / scale, y: pan.current.v.y - (e.clientY - pan.current.py) / scale }));
          return;
        }
        if (drag && e.buttons) setDrag({ ...drag, ...toBoard(e) });
      }}
      onPointerCancel={cancelPress}
      onPointerUp={() => {
        cancelPress();
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
      </defs>
      {background && <image href={imageUrl(background)} width={W} height={H} preserveAspectRatio="xMidYMid meet" data-testid="board-bg" pointerEvents="none" />}
      <rect width={W} height={H} fill="url(#grid)" pointerEvents="none" />
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
        return (
          <g
            key={o.id}
            data-testid={`obj-${o.name}`}
            data-x={Math.round(pos.x)}
            data-y={Math.round(pos.y)}
            data-mine={mine ? "true" : undefined}
            data-locked={o.locked ? "true" : undefined}
            style={{ cursor: canMove(o) ? "grab" : "default" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.altKey && onPing && !onPick) {
                const p = toBoard(e);
                return void onPing(Math.round(p.x), Math.round(p.y));
              }
              startPress(e);
              onSelect(o.id);
              if (canMove(o)) {
                onDragStart?.(o);
                (e.currentTarget as SVGGElement).ownerSVGElement?.setPointerCapture(e.pointerId);
                setDrag({ id: o.id, x: o.x, y: o.y });
              }
            }}
          >
            <circle className="tok-hit" cx={pos.x} cy={pos.y} r={44} />
            {mine && <circle cx={pos.x} cy={pos.y} r={R + 5} fill="none" stroke="#4cc38a" strokeWidth="1.5" opacity="0.55" data-testid="mine-ring" pointerEvents="none" />}
            {turnTokenIds?.includes(o.id) && (
              <g pointerEvents="none" data-testid="turn-ring">
                <circle cx={pos.x} cy={pos.y} r={R + 13} fill="none" stroke="#f0b429" strokeWidth="2.5" strokeDasharray="5 4" />
                <rect x={pos.x - 20} y={pos.y + R + 24} width="40" height="16" rx="8" fill="#f0b429" />
                <text x={pos.x} y={pos.y + R + 36} textAnchor="middle" fill="#08090a" fontSize="11" fontWeight="700">차례</text>
              </g>
            )}
            {selectedId === o.id && <circle cx={pos.x} cy={pos.y} r={R + 8} fill="none" stroke="#7c86f7" strokeWidth="2" />}
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
            <text x={pos.x} y={pos.y + (o.kind === "token" ? R + 18 : o.image ? 48 : 32)} textAnchor="middle" fill={hidden ? "#e3a94a" : "#a0a7b0"} fontSize="12" pointerEvents="none">
              {o.name}
              {hidden ? " · GM 전용" : ""}
              {o.locked ? " · 잠김" : ""}
            </text>
            {drag?.id === o.id && Math.hypot(drag.x - o.x, drag.y - o.y) >= CELL / 8 && (
              <g pointerEvents="none" data-testid="move-dist">
                <line x1={o.x} y1={o.y} x2={drag.x} y2={drag.y} stroke="#b8c7ff" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.7" />
                <circle cx={o.x} cy={o.y} r={3} fill="#b8c7ff" opacity="0.7" />
                <text x={drag.x + R + 10} y={drag.y + 5} fill="#e7e9ec" fontSize="14" fontWeight="600" stroke="#08090a" strokeWidth="3" paintOrder="stroke">
                  {(Math.hypot(drag.x - o.x, drag.y - o.y) / CELL).toFixed(1)}칸
                </text>
              </g>
            )}
            {mine && (
              <g pointerEvents="none" data-testid="mine-badge">
                <rect x={pos.x + R - 12} y={pos.y - R - 6} width="22" height="16" rx="8" fill="#4cc38a" />
                <text x={pos.x + R - 1} y={pos.y - R + 6} textAnchor="middle" fill="#08090a" fontSize="11" fontWeight="700">나</text>
              </g>
            )}
          </g>
        );
      })}
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
    <div className="zoom-ctl" role="group" aria-label="보드 확대·이동">
      <button type="button" className="btn sm" aria-label="확대" onClick={() => zoomAt(1.25)} disabled={view.w <= W / MAX_ZOOM + 0.5}>＋</button>
      <button type="button" className="btn sm" aria-label="축소" onClick={() => zoomAt(0.8)} disabled={!zoomed}>－</button>
      {zoomed && <button type="button" className="btn sm" onClick={() => setView(FULL)}>전체</button>}
      {mineToken && <button type="button" className="btn sm" data-testid="focus-mine" onClick={() => centerOn(mineToken.x, mineToken.y)}>내 토큰</button>}
    </div>
    </>
  );
}
