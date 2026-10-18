import { describe, expect, it } from "vitest";
import type { RollOutcome } from "@coc-vtt/shared";
import { sanEffectKind } from "./san";

const san = (over: Record<string, unknown>) => ({ kind: "san", expr: "0/1d6", target: 50, level: "regular", success: false, loss: 0, before: 50, after: 50, dailyLoss: 0, percent: { total: 60 }, ...over }) as unknown as RollOutcome;

describe("SAN 효과 고르기", () => {
  it("작은 손실은 효과가 없다", () => {
    expect(sanEffectKind(san({ loss: 4 }))).toBeNull();
    expect(sanEffectKind(san({ loss: 0, success: true }))).toBeNull();
  });
  it("5 이상 잃으면 큰 손실", () => {
    expect(sanEffectKind(san({ loss: 5 }))).toBe("heavy");
  });
  it("새 광기가 생기면 손실 양과 상관없이 광기", () => {
    expect(sanEffectKind(san({ loss: 5, madness: "temporary" }))).toBe("madness");
    expect(sanEffectKind(san({ loss: 1, madness: "indefinite" }))).toBe("madness");
  });
  it("SAN이 아닌 굴림은 무시한다", () => {
    expect(sanEffectKind({ kind: "dice" } as unknown as RollOutcome)).toBeNull();
  });
});
