import { describe, expect, it } from "vitest";
import type { Initiative } from "@coc-vtt/shared";
import { findTurnTokens, isMyTurn, offTurnNotice } from "./turn";

const init = (turn: number, extra: Partial<Initiative["entries"][number]>[] = []): Initiative => ({
  turn,
  round: 1,
  entries: [
    { id: "e1", name: "윤서하", dex: 70, characterId: "c1" },
    { id: "e2", name: "한도윤", dex: 60, characterId: "c2", ...extra[0] },
    { id: "e3", name: "광신도", dex: 50 },
  ],
});
const chars = [
  { id: "c1", ownerId: "u1" },
  { id: "c2", ownerId: "u2" },
];
const tokens = [
  { id: "t1", kind: "token", name: "윤서하", ownerId: "u1" },
  { id: "t2", kind: "token", name: "한도윤", ownerId: "u2" },
  { id: "p", kind: "prop", name: "상자" },
];

describe("findTurnTokens", () => {
  it("캐릭터 → 주인 → 그 PL의 토큰을 찾는다", () => {
    expect(findTurnTokens(init(0), chars, tokens)).toEqual(["t1"]);
    expect(findTurnTokens(init(1), chars, tokens)).toEqual(["t2"]);
  });
  it("전투가 없거나 NPC 칸이거나 토큰이 없으면 빈 목록", () => {
    expect(findTurnTokens(null, chars, tokens)).toEqual([]);
    expect(findTurnTokens(init(2), chars, tokens)).toEqual([]);
    expect(findTurnTokens(init(0), chars, [tokens[1]!])).toEqual([]);
  });
  it("남의 시트를 몰라도 서버가 채운 ownerId로 찾는다", () => {
    expect(findTurnTokens(init(1, [{ ownerId: "u2" }]), [], tokens)).toEqual(["t2"]);
    expect(findTurnTokens(init(1), [], tokens)).toEqual([]);
  });
  it("토큰이 여럿이면 캐릭터 이름과 같은 토큰을, 같은 이름이 없으면 그 PL의 토큰 모두를 고른다", () => {
    const many = [{ id: "a", kind: "token", name: "소환수", ownerId: "u1" }, ...tokens];
    expect(findTurnTokens(init(0), chars, many)).toEqual(["t1"]);
    expect(findTurnTokens(init(0), chars, [{ id: "a", kind: "token", name: "소환수", ownerId: "u1" }, { id: "b", kind: "token", name: "전투", ownerId: "u1" }])).toEqual(["a", "b"]);
  });
});

describe("offTurnNotice", () => {
  it("차례가 아닌 PL이 끌면 차례인 사람 이름으로 안내한다", () => {
    expect(offTurnNotice(init(0), chars, "u2", "t2", ["t1"])).toEqual({ text: "지금은 윤서하의 차례예요", turnKey: "1:e1" });
  });
  it("내 차례거나 전투가 없으면 안내하지 않는다", () => {
    expect(offTurnNotice(init(0), chars, "u1", "t1", ["t1"])).toBeNull();
    expect(offTurnNotice(null, chars, "u2", "t2", [])).toBeNull();
  });
  it("NPC 차례에도 안내한다", () => {
    expect(offTurnNotice(init(2), chars, "u1", "t1", [])?.text).toBe("지금은 광신도의 차례예요");
  });
});

describe("isMyTurn", () => {
  it("내 캐릭터 칸이면 true", () => {
    expect(isMyTurn(init(0), chars, "u1")).toBe(true);
    expect(isMyTurn(init(0), chars, "u2")).toBe(false);
  });
});
