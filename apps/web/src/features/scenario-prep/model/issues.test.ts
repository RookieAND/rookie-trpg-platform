import { describe, expect, it } from "vitest";
import { issueLine, jsonSyntaxMessage, whereKo } from "./issues";

describe("whereKo", () => {
  it("배열 칸은 n번째로", () => expect(whereKo("tokens[2] (낡은 상자) · x")).toBe("3번째 토큰·소품 (낡은 상자) · 가로 위치"));
  it("점 경로", () => expect(whereKo("scenes[0].name")).toBe("1번째 장면 · 이름"));
  it("맨 위", () => expect(whereKo("format")).toBe("형식"));
  it("파일", () => expect(whereKo("파일")).toBe("파일"));
});

describe("issueLine", () => {
  it("빠진 항목", () => expect(issueLine("tokens[2] (상자) · kind", "빠졌어요.")).toBe("3번째 토큰·소품 (상자) · 종류: 빠졌어요. 꼭 있어야 하는 항목이에요."));
  it("겹친 key", () => expect(issueLine("scenes[1] (a)", 'key "a"가 겹쳐요.')).toContain('이름표(key) "a"가 다른 항목과 겹쳐요'));
});

describe("jsonSyntaxMessage", () => {
  it("위치로 줄·칸", () => {
    const text = '{\n  "a": 1,\n  "b": }\n';
    let err: unknown;
    try { JSON.parse(text); } catch (e) { err = e; }
    expect(jsonSyntaxMessage(text, err)).toMatch(/^3번째 줄 \d+번째 칸 근처에서 JSON 형식이 맞지 않아요/);
  });
  it("위치를 모르면 일반 문장", () => expect(jsonSyntaxMessage("x", new Error("bad"))).toMatch(/^JSON 형식이 맞지 않아요/));
});
