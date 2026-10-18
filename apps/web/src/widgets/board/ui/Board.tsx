"use client";
import { useRef, useState } from "react";
import type { FogArea, GameObject, Role } from "@coc-vtt/shared";
import { imageUrl } from "@/shared/api";

const W = 1000;
const H = 800;
const R = 24;

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
}

export function Board({ objects, background, me, canInteract, onMove, selectedId, onSelect, fog, onPick }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

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
    <svg
      ref={svg}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="img"
      aria-label="게임 보드"
      data-testid="board"
      onPointerDown={(e) => {
        if (e.target !== svg.current) return;
        if (onPick) {
          const p = toBoard(e);
          onPick(Math.round(p.x), Math.round(p.y));
        } else onSelect(null);
      }}
      onPointerMove={(e) => drag && setDrag({ ...drag, ...toBoard(e) })}
      onPointerUp={() => {
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
      {background && <image href={imageUrl(background)} width={W} height={H} preserveAspectRatio="xMidYMid slice" data-testid="board-bg" pointerEvents="none" />}
      <rect width={W} height={H} fill="url(#grid)" pointerEvents="none" />
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
        const stroke = hidden ? "#e3a94a" : o.kind === "token" ? "#b8c7ff" : "#6b727c";
        const fill = hidden ? "rgba(227,169,74,.12)" : o.kind === "token" ? "#2b3a5e" : "#23272d";
        return (
          <g
            key={o.id}
            data-testid={`obj-${o.name}`}
            data-x={Math.round(pos.x)}
            data-y={Math.round(pos.y)}
            style={{ cursor: canMove(o) ? "grab" : "default" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(o.id);
              if (canMove(o)) {
                (e.currentTarget as SVGGElement).ownerSVGElement?.setPointerCapture(e.pointerId);
                setDrag({ id: o.id, x: o.x, y: o.y });
              }
            }}
          >
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
            </text>
          </g>
        );
      })}
    </svg>
  );
}
