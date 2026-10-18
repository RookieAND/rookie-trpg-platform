import { describe, expect, it } from "vitest";
import { fadeTimings, shouldFade } from "./fade";

describe("장면 페이드", () => {
  it("움직임 줄이기에서는 훨씬 짧다", () => {
    const a = fadeTimings(false);
    const b = fadeTimings(true);
    expect(b.outMs + b.inMs).toBeLessThan(a.outMs + a.inMs);
    expect(a.outMs).toBeGreaterThan(0);
  });
  it("컷, 효과 끔, 재접속 직후에는 연출하지 않는다", () => {
    const base = { kind: "fade" as const, enabled: true, reconnectedAt: 0, now: 10_000 };
    expect(shouldFade(base)).toBe(true);
    expect(shouldFade({ ...base, kind: "cut" })).toBe(false);
    expect(shouldFade({ ...base, enabled: false })).toBe(false);
    expect(shouldFade({ ...base, reconnectedAt: 9_000 })).toBe(false);
    expect(shouldFade({ ...base, reconnectedAt: 1_000 })).toBe(true);
  });
});
