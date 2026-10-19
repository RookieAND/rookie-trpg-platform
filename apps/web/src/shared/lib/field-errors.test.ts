import { describe, expect, it } from "vitest";
import { LIMITS } from "@coc-vtt/shared";
import { badCommandMessage, limitMessage, limitNote } from "./field-errors";

describe("한도 안내 문구", () => {
  it("받침에 맞는 조사를 붙여요", () => {
    expect(limitMessage("핸드아웃 제목", 60)).toBe("핸드아웃 제목은 60자까지예요.");
    expect(limitMessage("장면 이름", 40)).toBe("장면 이름은 40자까지예요.");
    expect(limitMessage("대화", 500)).toBe("대화는 500자까지예요.");
  });
  it("한도에 닿았을 때만 보여 줘요", () => {
    expect(limitNote("핸드아웃 제목", "handoutTitle", "가".repeat(LIMITS.handoutTitle - 1))).toBeNull();
    expect(limitNote("핸드아웃 제목", "handoutTitle", "가".repeat(LIMITS.handoutTitle))).toContain("60자까지");
  });
});

describe("badCommandMessage", () => {
  it("핸드아웃 제목이 길면 그 칸을 짚어요", () => {
    expect(badCommandMessage({ type: "handout.create", data: { title: "가".repeat(61), body: "" } })).toBe("핸드아웃 제목은 60자까지예요.");
  });
  it("장면 이름이 길면 그 칸을 짚어요", () => {
    expect(badCommandMessage({ type: "scene.create", data: { name: "나".repeat(41) } })).toBe("장면 이름은 40자까지예요.");
  });
  it("핸드아웃 내용, 무기 이름처럼 안쪽 칸도 짚어요", () => {
    expect(badCommandMessage({ type: "handout.update", data: { id: "h", body: "가".repeat(4001) } })).toBe("핸드아웃 내용은 4000자까지예요.");
  });
  it("비어 있으면 적어 달라고 해요", () => {
    expect(badCommandMessage({ type: "scene.rename", data: { id: "s", name: "   " } })).toBe("장면 이름을 적어 주세요.");
  });
  it("규격을 통과하거나 모르는 칸이면 null이에요", () => {
    expect(badCommandMessage({ type: "scene.create", data: { name: "광장" } })).toBeNull();
    expect(badCommandMessage({ type: "board.ping", data: { sceneId: "", x: 0, y: 0 } })).toBeNull();
  });
});
