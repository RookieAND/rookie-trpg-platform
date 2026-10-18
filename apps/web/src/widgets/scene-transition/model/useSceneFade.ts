"use client";
import { useEffect, useRef, useState } from "react";
import { fadeTimings, shouldFade, type FadeTimings } from "./fade";

type Transition = { kind: "cut" | "fade"; n: number } | null;
interface Active<T> { n: number; frozen: T; swapped: boolean; timings: FadeTimings }

/**
 * 페이드 전환을 두 단계로 만든다. 장면이 바뀐 이벤트가 오면 이전 화면(frozen)을 붙잡은 채 어두워지고,
 * 다 어두워지면 새 화면으로 바꾼 뒤 밝아진다. 컷·효과 끔·재접속 직후는 바로 바뀐다.
 */
export function useSceneFade<T>(live: T, transition: Transition, reconnectedAt: number, enabled: boolean): { shown: T; fade: { n: number; timings: FadeTimings } | null } {
  const [active, setActive] = useState<Active<T> | null>(null);
  const seen = useRef(transition?.n ?? 0);
  const prevLive = useRef(live);
  useEffect(() => {
    prevLive.current = live;
  });

  if (transition && transition.n !== seen.current) {
    seen.current = transition.n;
    if (shouldFade({ kind: transition.kind, enabled, reconnectedAt, now: Date.now() })) {
      const reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      setActive({ n: transition.n, frozen: prevLive.current, swapped: false, timings: fadeTimings(reduced) });
    }
  }

  const n = active?.n;
  const timings = active?.timings;
  useEffect(() => {
    if (n === undefined || !timings) return;
    const swap = setTimeout(() => setActive((a) => (a && a.n === n ? { ...a, swapped: true } : a)), timings.outMs);
    const done = setTimeout(() => setActive((a) => (a && a.n === n ? null : a)), timings.outMs + timings.inMs + 50);
    return () => {
      clearTimeout(swap);
      clearTimeout(done);
    };
  }, [n, timings]);

  return { shown: active && !active.swapped ? active.frozen : live, fade: active ? { n: active.n, timings: active.timings } : null };
}
