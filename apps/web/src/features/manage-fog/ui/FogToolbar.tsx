"use client";
import { useState } from "react";
import { FOG_MAX_RADIUS, MAX_FOG_ZONES, type ClientCommand, type GameObject, type Scene } from "@coc-vtt/shared";

/** KP의 안개 도구: 장면의 안개를 켜고, 밝은 영역을 찍고, 토큰에 시야를 준다. */
export function FogToolbar({
  scene,
  selected,
  partyTokens = [],
  enabled,
  picking,
  radius,
  onPicking,
  onRadius,
  send,
}: {
  scene: Scene;
  selected?: GameObject;
  /** 이 장면에서 PL이 소유한 토큰. 한 번에 시야를 줄 때 쓴다. */
  partyTokens?: GameObject[];
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
  const explored = fog?.explored?.length ?? 0;
  const [vision, setVision] = useState(120);

  return (
    <div className="dock" data-testid="fog-toolbar" style={{ bottom: 100, flexWrap: "wrap", justifyContent: "center", maxWidth: "calc(100% - 24px)" }}>
      <span className="dock-label" title="안개를 켜면 PL은 밝힌 영역과 시야 안만 볼 수 있어요">안개</span>
      <button className="btn" aria-pressed={on} disabled={!enabled} onClick={() => send({ type: "scene.fog", data: { id: scene.id, enabled: !on } })}>
        안개 {on ? "끄기" : "켜기"}
      </button>
      {on && (
        <>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            반지름 {radius}
            <input type="range" min={20} max={FOG_MAX_RADIUS} step={10} value={radius} aria-label="밝힐 반지름" onChange={(e) => onRadius(Number(e.target.value))} style={{ accentColor: "#7c86f7" }} />
          </label>
          <button className="btn" aria-pressed={picking} disabled={!enabled || zones.length >= MAX_FOG_ZONES} onClick={() => onPicking(!picking)}>
            {picking ? "보드를 눌러 밝히는 중…" : "영역 밝히기"}
          </button>
          {partyTokens.length > 0 && (
            <button
              className="btn"
              disabled={!enabled || !(vision >= 10 && vision <= FOG_MAX_RADIUS)}
              title="이 장면의 PL 토큰 모두에게 아래 시야 반지름을 줘요"
              onClick={() => partyTokens.forEach((t) => send({ type: "object.update", data: { id: t.id, vision: Math.round(vision) } }))}
            >
              PL 전원 시야 주기 ({vision})
            </button>
          )}
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            시야
            <input className="input mono" style={{ width: 70, height: 28 }} type="number" min={10} max={FOG_MAX_RADIUS} aria-label="시야 반지름" value={vision} onChange={(e) => setVision(Number(e.target.value))} />
          </label>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }} data-testid="fog-zones">밝힌 영역 {zones.length}</span>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }} data-testid="fog-explored-count">탐험 기록 {explored}</span>
          {explored > 0 && (
            <button className="btn" disabled={!enabled} onClick={() => send({ type: "fog.forget", data: { sceneId: scene.id } })}>
              탐험 기록 지우기
            </button>
          )}
          {zones.length > 0 && (
            <>
              <button className="btn" disabled={!enabled} onClick={() => send({ type: "fog.remove", data: { sceneId: scene.id, zoneId: zones[zones.length - 1]!.id } })}>
                마지막 영역 되돌리기
              </button>
              <button className="btn" disabled={!enabled} onClick={() => send({ type: "fog.clear", data: { sceneId: scene.id } })}>
                영역 모두 지우기
              </button>
            </>
          )}
        </>
      )}
      {selected && selected.sceneId === scene.id && (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{selected.name} 시야 {selected.vision ?? "없음"}</span>
          <button className="btn" disabled={!enabled || !(vision >= 10 && vision <= FOG_MAX_RADIUS)} onClick={() => send({ type: "object.update", data: { id: selected.id, vision: Math.round(vision) } })}>시야 주기</button>
          {selected.vision ? <button className="btn" disabled={!enabled} onClick={() => send({ type: "object.update", data: { id: selected.id, vision: 0 } })}>시야 없애기</button> : null}
        </span>
      )}
    </div>
  );
}
