import { describe, expect, it } from "vitest";
import { formatRollLog } from "./roll-log-export";
import type { RollLogEntry } from "./protocol";

const entry = (over: Partial<RollLogEntry>): RollLogEntry => ({
  id: "r1",
  userId: "u",
  userName: "윤서하",
  expr: "1d6",
  outcome: { kind: "dice", rolls: [4], modifier: 0, total: 4 } as RollLogEntry["outcome"],
  session: 1,
  secret: false,
  at: Date.UTC(2026, 9, 17, 17, 1),
  ...over,
});

describe("굴림 기록 내보내기", () => {
  it("세션별로 묶고 오래된 굴림을 위에 둔다", () => {
    const text = formatRollLog(
      [entry({ id: "b", session: 2, at: Date.UTC(2026, 9, 18, 1, 0), userName: "나중" }), entry({ id: "a", userName: "먼저", label: "카를로 · 도서관" })],
      { title: "테스트 룸", isKp: true, timeZone: "Asia/Seoul" },
    );
    expect(text.startsWith("# 테스트 룸\n")).toBe(true);
    expect(text.indexOf("## 세션 1")).toBeLessThan(text.indexOf("## 세션 2"));
    expect(text).toContain("- 10/18 02:01 **먼저 · 카를로 · 도서관** `1d6` — [4] = 4");
    expect(text.indexOf("먼저")).toBeLessThan(text.indexOf("나중"));
  });

  it("비밀·푸시·행운 표시를 달고, KP가 아니면 안내를 붙인다", () => {
    const rolls = [entry({ secret: true, pushOf: "x" })];
    expect(formatRollLog(rolls, { isKp: true, timeZone: "UTC" })).toContain("(비밀, 푸시)");
    expect(formatRollLog(rolls, { isKp: true, timeZone: "UTC" })).not.toContain("볼 수 있었던");
    expect(formatRollLog(rolls, { isKp: false, timeZone: "UTC" })).toContain("볼 수 있었던 굴림만");
  });

  it("굴림이 없으면 그렇게 적는다", () => {
    expect(formatRollLog([], { isKp: true })).toContain("굴림이 없어요.");
  });
});
