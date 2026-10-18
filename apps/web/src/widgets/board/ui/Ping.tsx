"use client";
import { useEffect, useRef, useState } from "react";
import type { BoardPing } from "@coc-vtt/shared";

/** 핑이 화면에 남는 시간(ms) */
export const PING_LIFE_MS = 1800;

/**
 * 보드 위에 그리는 핑. 받은 시각(이 화면의 시계)부터 PING_LIFE_MS 동안 파동과 이름표를 보여 주고,
 * 지금 보는 장면의 핑만 그린다. animate가 꺼져 있으면(움직임 줄이기) 파동 없이 고정된 고리만 보여 준다.
 */
export function Pings({ pings, sceneId, animate }: { pings: BoardPing[]; sceneId: string; animate: boolean }) {
  const seen = useRef(new Map<string, number>());
  const [tick, setTick] = useState(0);
  const now = Date.now();
  for (const p of pings) if (!seen.current.has(p.id)) seen.current.set(p.id, now);
  const live = pings.filter((p) => p.sceneId === sceneId && now - (seen.current.get(p.id) ?? now) < PING_LIFE_MS);

  useEffect(() => {
    if (live.length === 0) return;
    const t = Date.now();
    const next = Math.min(...live.map((p) => (seen.current.get(p.id) ?? t) + PING_LIFE_MS)) - t;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(30, next + 20));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pings, sceneId, tick]);

  if (live.length === 0) return null;
  return (
    <g pointerEvents="none" aria-hidden="true">
      {live.map((p) => (
        <g key={p.id} data-testid="ping" data-user={p.userId} data-x={p.x} data-y={p.y} className={animate ? "ping ping-anim" : "ping"}>
          {animate ? (
            <>
              <circle className="ping-wave" cx={p.x} cy={p.y} r={40} />
              <circle className="ping-wave w2" cx={p.x} cy={p.y} r={40} />
            </>
          ) : (
            <circle cx={p.x} cy={p.y} r={26} fill="none" stroke="#f0b429" strokeWidth="3" strokeDasharray="3 5" />
          )}
          <circle cx={p.x} cy={p.y} r={6} fill="#f0b429" stroke="#08090a" strokeWidth="1.5" />
          <text x={p.x} y={p.y - 48} textAnchor="middle" fontSize="16" fontWeight="600" fill="#f0b429" stroke="#08090a" strokeWidth="3" paintOrder="stroke">
            {p.userName}
          </text>
        </g>
      ))}
    </g>
  );
}
