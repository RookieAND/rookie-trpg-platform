import { describe, expect, it } from "vitest";
import { rollBlockReason } from "./roll-reason";

describe("rollBlockReason", () => {
  it("진행 중이면 PL과 GM 모두 막힌 이유가 없다", () => {
    expect(rollBlockReason("pl", "ACTIVE")).toBeNull();
    expect(rollBlockReason("kp", "ACTIVE")).toBeNull();
  });
  it("세션 전에는 누가 무엇을 해야 하는지 말한다", () => {
    expect(rollBlockReason("pl", "IDLE")).toContain("GM이 세션을 시작");
    expect(rollBlockReason("kp", "IDLE")).toContain("세션 시작");
  });
  it("일시정지와 관전자도 이유를 말한다", () => {
    expect(rollBlockReason("pl", "PAUSED")).toContain("일시정지");
    expect(rollBlockReason("kp", "PAUSED")).toContain("이어하기");
    expect(rollBlockReason("spectator", "ACTIVE")).toContain("관전자");
  });
});
