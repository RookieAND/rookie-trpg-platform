import { describe, expect, it } from "vitest";
import { josa } from "./josa";

describe("josa", () => {
  it("한글 받침 있음/없음", () => {
    expect(josa("도윤", "을/를")).toBe("도윤을");
    expect(josa("서하", "을/를")).toBe("서하를");
    expect(josa("도윤", "은/는")).toBe("도윤은");
    expect(josa("서하", "은/는")).toBe("서하는");
    expect(josa("도윤", "이/가")).toBe("도윤이");
    expect(josa("서하", "이/가")).toBe("서하가");
    expect(josa("도윤", "과/와")).toBe("도윤과");
    expect(josa("서하", "과/와")).toBe("서하와");
    expect(josa("도윤", "이에요/예요")).toBe("도윤이에요");
    expect(josa("서하", "이에요/예요")).toBe("서하예요");
  });

  it("으로/로는 ㄹ받침을 받침 없음으로 본다", () => {
    expect(josa("서울", "으로/로")).toBe("서울로");
    expect(josa("도서관", "으로/로")).toBe("도서관으로");
    expect(josa("바다", "으로/로")).toBe("바다로");
  });

  it("GM은 지엠이라 받침이 있다", () => {
    expect(josa("GM", "이/가")).toBe("GM이");
    expect(josa("GM", "은/는")).toBe("GM은");
    expect(josa("GM", "을/를")).toBe("GM을");
    expect(josa("GM", "과/와")).toBe("GM과");
    expect(josa("GM", "으로/로")).toBe("GM으로");
  });

  it("숫자는 읽는 소리로 따진다", () => {
    expect(josa("32", "을/를")).toBe("32를");
    expect(josa("62", "이/가")).toBe("62가");
    expect(josa("30", "이/가")).toBe("30이");
    expect(josa("30", "으로/로")).toBe("30으로");
    expect(josa("1", "으로/로")).toBe("1로");
    expect(josa("8", "은/는")).toBe("8은");
    expect(josa("5", "은/는")).toBe("5는");
  });

  it("알파벳은 글자 이름으로 따진다", () => {
    expect(josa("HP", "이/가")).toBe("HP가");
    expect(josa("DEX", "은/는")).toBe("DEX는");
    expect(josa("SAN", "이/가")).toBe("SAN이");
    expect(josa("STR", "으로/로")).toBe("STR로");
    expect(josa("POW", "을/를")).toBe("POW를");
  });

  it("따옴표·괄호는 건너뛰고 앞 글자를 본다", () => {
    expect(josa("'신용도'", "은/는")).toBe("'신용도'는");
    expect(josa("'도윤'", "을/를")).toBe("'도윤'을");
    expect(josa("", "을/를")).toBe("를");
  });
});
