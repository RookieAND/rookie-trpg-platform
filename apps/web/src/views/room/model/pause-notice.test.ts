import { describe, expect, it } from "vitest";
import { pauseNotice } from "./pause-notice";

describe("pauseNotice", () => {
  it("GM에게는 GM이 돌아오면 같은 말을 하지 않고 이어하기를 안내한다", () => {
    for (const reason of ["kp_request", "kp_disconnected", null] as const) {
      const t = pauseNotice("kp", reason);
      expect(t).not.toContain("돌아오면");
      expect(t).toContain("이어하기");
    }
  });
  it("PL에게는 멈춘 이유에 맞게 말한다", () => {
    expect(pauseNotice("pl", "kp_disconnected")).toBe("세션이 일시정지 중이에요. GM이 돌아오면 이어서 진행해요.");
    expect(pauseNotice("pl", "kp_request")).not.toContain("돌아오면");
    expect(pauseNotice("spectator", "kp_request")).toContain("이어하기");
  });
});
