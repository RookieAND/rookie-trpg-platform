"use client";
import type { CSSProperties } from "react";
import type { FadeTimings } from "../model/fade";

/** 보드 위에 깔리는 검은 막. 어두워졌다가(out) 밝아진다(in). fade가 null이면 아무것도 그리지 않는다. */
export function SceneTransition({ fade }: { fade: { n: number; timings: FadeTimings } | null }) {
  if (!fade) return null;
  const style = { "--fade-out": `${fade.timings.outMs}ms`, "--fade-in": `${fade.timings.inMs}ms` } as CSSProperties;
  return <div key={fade.n} className="scene-fade" style={style} data-testid="scene-fade" aria-hidden="true" />;
}
