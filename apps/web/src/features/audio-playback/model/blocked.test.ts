import { describe, expect, it } from "vitest";
import { isAudioBlocked } from "./blocked";

describe("소리가 막혔는지", () => {
  it("틀 소리가 없으면 막혔다고 하지 않는다", () => {
    expect(isAudioBlocked({ wantsSound: false, unlocked: false, ctxState: "none" })).toBe(false);
  });
  it("아직 풀지 못했거나 멈춰 있으면 막힌 것이다", () => {
    expect(isAudioBlocked({ wantsSound: true, unlocked: false, ctxState: "none" })).toBe(true);
    expect(isAudioBlocked({ wantsSound: true, unlocked: true, ctxState: "suspended" })).toBe(true);
  });
  it("재생 중이면 풀린 것이다", () => {
    expect(isAudioBlocked({ wantsSound: true, unlocked: true, ctxState: "running" })).toBe(false);
  });
});
