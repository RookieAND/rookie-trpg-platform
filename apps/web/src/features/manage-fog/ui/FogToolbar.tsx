"use client";
import { useState } from "react";
import { FOG_MAX_RADIUS, MAX_FOG_ZONES, type ClientCommand, type GameObject, type Scene } from "@coc-vtt/shared";

/** KP의 안개 도구: 장면의 안개를 켜고, 밝은 영역을 찍고, 토큰에 시야를 준다. */
export function FogToolbar({
  scene,
  selected,
  enabled,
  picking,
  radius,
  onPicking,
  onRadius,
  send,
}: {
  scene: Scene;
  selected?: GameObject;
  enabled: boolean;
  picking: boolean;
  radius: number;
  onPicking: (on: boolean) => void;
  onRadius: (r: number) => void;
  send: (c: ClientCommand) => unknown;
}) {
  const fog = scene.fog;
  const on = !!fog?.enabled;
  const zones = fog?.zones ?? [];
  const [vision, setVision] = useState(120);

  return (
    <div className="scenebar" data-testid="fog-toolbar" style={{ top: "auto", bottom: 100, left: "50%", right: "auto", transform: "translateX(-50%)", width: "max-content", maxWidth: "calc(100% - 24px)", flexWrap: "wrap", justifyContent: "center" }}>
      <button className="btn" style={{ height: 28 }} aria-pressed={on} disabled={!enabled} onClick={() => send({ type: "scene.fog", data: { id: scene.id, enabled: !on } })}>
        안개 {on ? "끄기" : "켜기"}
      </button>
      {on && (
        <>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            반지름 {radius}
            <input type="range" min={20} max={FOG_MAX_RADIUS} step={10} value={radius} aria-label="밝힐 반지름" onChange={(e) => onRadius(Number(e.target.value))} style={{ accentColor: "#5fd3a4" }} />
          </label>
          <button className="btn" style={{ height: 28 }} aria-pressed={picking} disabled={!enabled || zones.length >= MAX_FOG_ZONES} onClick={() => onPicking(!picking)}>
            {picking ? "보드를 눌러 밝히는 중…" : "영역 밝히기"}
          </button>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }} data-testid="fog-zones">밝힌 영역 {zones.length}</span>
          {zones.length > 0 && (
            <>
              <button className="btn" style={{ height: 28 }} disabled={!enabled} onClick={() => send({ type: "fog.remove", data: { sceneId: scene.id, zoneId: zones[zones.length - 1]!.id } })}>
                마지막 영역 되돌리기
              </button>
              <button className="btn" style={{ height: 28 }} disabled={!enabled} onClick={() => send({ type: "fog.clear", data: { sceneId: scene.id } })}>
                영역 모두 지우기
              </button>
            </>
          )}
        </>
      )}
      {selected && selected.sceneId === scene.id && (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{selected.name} 시야 {selected.vision ?? "없음"}</span>
          <input className="input mono" style={{ width: 70, height: 28 }} type="number" min={10} max={FOG_MAX_RADIUS} aria-label="시야 반지름" value={vision} onChange={(e) => setVision(Number(e.target.value))} />
          <button className="btn" style={{ height: 28 }} disabled={!enabled || !(vision >= 10 && vision <= FOG_MAX_RADIUS)} onClick={() => send({ type: "object.update", data: { id: selected.id, vision: Math.round(vision) } })}>시야 주기</button>
          {selected.vision ? <button className="btn" style={{ height: 28 }} disabled={!enabled} onClick={() => send({ type: "object.update", data: { id: selected.id, vision: 0 } })}>시야 없애기</button> : null}
        </span>
      )}
    </div>
  );
}
