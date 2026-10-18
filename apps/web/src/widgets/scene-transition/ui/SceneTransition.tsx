"use client";
import { useRef } from "react";

/** 재접속 직후 이 시간 안에 도착한 전환은 놓친 것을 다시 받은 것이라 연출하지 않는다. */
const REPLAY_WINDOW_MS = 2500;

/** 장면이 바뀔 때 보드 위에 깔리는 효과. n이 바뀔 때마다 새로 재생된다(컷은 효과 없음). enabled가 false면 내 설정으로 끈 것이다. */
export function SceneTransition({ transition, reconnectedAt = 0, enabled = true }: { transition: { kind: "cut" | "fade"; n: number } | null; reconnectedAt?: number; enabled?: boolean }) {
  const seen = useRef<{ n: number; skip: boolean }>({ n: transition?.n ?? 0, skip: false });
  if (transition && transition.n !== seen.current.n) {
    seen.current = { n: transition.n, skip: reconnectedAt > 0 && Date.now() - reconnectedAt < REPLAY_WINDOW_MS };
  }
  if (!enabled || !transition || transition.kind !== "fade" || seen.current.skip) return null;
  return <div key={transition.n} className="scene-fade" data-testid="scene-fade" aria-hidden="true" />;
}
