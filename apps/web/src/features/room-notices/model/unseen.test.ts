import { describe, expect, it } from "vitest";
import { unseenIds } from "./unseen";
import { isMyTurn } from "./turn";

describe("unseenIds", () => {
  it("본 적 없는 것만 돌려준다", () => {
    expect(unseenIds(new Set(["a", "b"]), ["a", "b", "c"])).toEqual(["c"]);
    expect(unseenIds(new Set(["a"]), ["a"])).toEqual([]);
  });
});

describe("isMyTurn", () => {
  const chars = [{ id: "c1", ownerId: "u1" }, { id: "c2", ownerId: "u2" }];
  const init = (turn: number) => ({
    round: 1,
    turn,
    entries: [{ id: "e1", name: "A", dex: 70, characterId: "c1" }, { id: "e2", name: "NPC", dex: 60 }, { id: "e3", name: "B", dex: 50, characterId: "c2" }],
  });
  it("지금 차례가 내 캐릭터일 때만 true", () => {
    expect(isMyTurn(init(0), chars, "u1")).toBe(true);
    expect(isMyTurn(init(0), chars, "u2")).toBe(false);
    expect(isMyTurn(init(2), chars, "u2")).toBe(true);
  });
  it("NPC 차례나 전투가 없으면 false", () => {
    expect(isMyTurn(init(1), chars, "u1")).toBe(false);
    expect(isMyTurn(null, chars, "u1")).toBe(false);
  });
});
