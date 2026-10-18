import { describe, expect, it } from "vitest";
import { isStaleRoll } from "./RollEffect";

describe("재접속으로 다시 받은 굴림", () => {
  it("방금 굴린 것은 연출하고, 오래된 것은 건너뛴다", () => {
    expect(isStaleRoll(1_000_000, 1_002_000)).toBe(false);
    expect(isStaleRoll(1_000_000, 1_020_000)).toBe(true);
  });
  it("시계가 크게 어긋난 기기에서는 이 검사를 건너뛴다", () => {
    expect(isStaleRoll(1_000_000, 1_000_000 + 10 * 60_000)).toBe(false);
    expect(isStaleRoll(2_000_000, 1_000_000)).toBe(false);
  });
});
