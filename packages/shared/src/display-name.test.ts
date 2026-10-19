import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX, isReservedDisplayName, memberDisplayName, sanitizeDisplayName } from "./display-name";

describe("sanitizeDisplayName", () => {
  it("제어 문자와 줄바꿈을 없애고 공백을 한 칸으로 줄인다", () => {
    expect(sanitizeDisplayName("<b>Owner</b>\nX")).toBe("<b>Owner</b>X");
    expect(sanitizeDisplayName("  서하 \t\t  윤  ")).toBe("서하 윤");
    expect(sanitizeDisplayName("a\u0000b\u0007c\u001bd")).toBe("abcd");
    expect(sanitizeDisplayName("줄\r\n바꿈 문단 ")).toBe("줄바꿈문단");
  });
  it("방향 덮어쓰기·제로폭 문자를 없앤다", () => {
    expect(sanitizeDisplayName("‮evil‬")).toBe("evil");
    expect(sanitizeDisplayName("a⁦b⁩c​d‏e﻿f")).toBe("abcdef");
  });
  it("글자 수를 코드포인트로 자른다(이모지가 반으로 갈리지 않는다)", () => {
    const long = "😀".repeat(100);
    const out = sanitizeDisplayName(long);
    expect(Array.from(out)).toHaveLength(DISPLAY_NAME_MAX);
    expect(out.includes("�")).toBe(false);
  });
  it("쌓이는 결합 문자는 3개까지만", () => {
    const zalgo = `x${"\u0301".repeat(30)}b`;
    expect(sanitizeDisplayName(zalgo)).toBe(`x${"\u0301".repeat(3)}b`);
  });
  it("비었거나 문자열이 아니면 fallback", () => {
    expect(sanitizeDisplayName("")).toBe("이름 없음");
    expect(sanitizeDisplayName("‮​ \n")).toBe("이름 없음");
    expect(sanitizeDisplayName(undefined)).toBe("이름 없음");
    expect(sanitizeDisplayName({ a: 1 }, "손님")).toBe("손님");
  });
  it("한글과 일반 이름은 그대로", () => {
    expect(sanitizeDisplayName("윤서하")).toBe("윤서하");
    expect(sanitizeDisplayName("Dr. Armitage")).toBe("Dr. Armitage");
  });
});

describe("memberDisplayName (GM 사칭)", () => {
  it("PL이 GM·KP 같은 이름을 쓰면 표시를 붙인다", () => {
    for (const n of ["GM", "gm", " G M ", "G.M.", "KP", "지엠", "게임 마스터", "운영자", "System"]) {
      expect(isReservedDisplayName(n)).toBe(true);
      expect(memberDisplayName(n, false)).toMatch(/\(참가자\)$/);
    }
  });
  it("GM 본인은 그대로 쓴다", () => expect(memberDisplayName("GM", true)).toBe("GM"));
  it("보통 이름은 그대로", () => expect(memberDisplayName("마스터키", false)).toBe("마스터키"));
  it("붙인 뒤에도 40자를 넘지 않는다", () => expect(Array.from(memberDisplayName("게임마스터", false)).length).toBeLessThanOrEqual(DISPLAY_NAME_MAX));
});
