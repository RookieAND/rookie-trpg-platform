import { describe, expect, it } from "vitest";
import { newTokenName, uniqueName } from "./names";

describe("newTokenName", () => {
  it("직접 적은 이름이 먼저", () => {
    expect(newTokenName(" 경비병 ", "서하", 3)).toBe("경비병");
  });
  it("소유자(PL)가 있으면 그 이름", () => {
    expect(newTokenName("", "서하", 3)).toBe("서하");
  });
  it("소유자 없는 NPC 토큰은 PL 이름 대신 토큰N", () => {
    expect(newTokenName("", undefined, 3)).toBe("토큰4");
  });
});

describe("uniqueName", () => {
  it("겹치면 번호를 붙인다", () => {
    expect(uniqueName("토큰4", ["토큰4"])).toBe("토큰4 2");
    expect(uniqueName("", [])).toBe("토큰");
  });
});
