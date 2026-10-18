import { describe, expect, it } from "vitest";
import { rollToastText, shouldToastRoll } from "./roll-toast";

const cc = { kind: "cc", expr: "CC<=60", target: 60, percent: { rolls: [30], total: 30, bonus: 0 }, level: "regular", success: true } as never;

describe("rollToastText", () => {
  it("캐릭터 · 기능과 결과를 한 줄로 만든다", () => {
    const t = rollToastText({ label: "서하 · 관찰력", expr: "CC<=60", outcome: cc, secret: false });
    expect(t.startsWith("서하 · 관찰력 · ")).toBe(true);
    expect(t).toContain("30");
  });
  it("라벨이 없으면 식을 쓰고, 비밀 굴림이면 그렇게 표시한다", () => {
    expect(rollToastText({ expr: "CC<=60", outcome: cc, secret: true }).startsWith("비밀 굴림 · CC<=60 · ")).toBe(true);
  });
});

describe("shouldToastRoll", () => {
  it("시트에서 굴린 직후 내 굴림만", () => {
    expect(shouldToastRoll(1000, 3000, "me", "me")).toBe(true);
    expect(shouldToastRoll(1000, 3000, "other", "me")).toBe(false);
    expect(shouldToastRoll(0, 3000, "me", "me")).toBe(false);
    expect(shouldToastRoll(1000, 20000, "me", "me")).toBe(false);
  });
});
