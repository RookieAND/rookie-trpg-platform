/** 페이드 전환 시간. 어두워지는 동안 이전 장면을 붙잡아 두고, 다 어두워지면 새 장면으로 바꾼 뒤 밝아진다. */
export interface FadeTimings {
  outMs: number;
  inMs: number;
}

export function fadeTimings(reducedMotion: boolean): FadeTimings {
  return reducedMotion ? { outMs: 150, inMs: 200 } : { outMs: 400, inMs: 700 };
}

/** 재접속 직후 이 시간 안에 도착한 전환은 놓친 것을 다시 받은 것이라 연출하지 않는다. */
export const REPLAY_WINDOW_MS = 2500;

export function shouldFade(opts: { kind: "cut" | "fade"; enabled: boolean; reconnectedAt: number; now: number }): boolean {
  if (!opts.enabled || opts.kind !== "fade") return false;
  return !(opts.reconnectedAt > 0 && opts.now - opts.reconnectedAt < REPLAY_WINDOW_MS);
}
