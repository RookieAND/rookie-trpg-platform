import { describe, expect, it } from "vitest";
import { roomTitle } from "./useDocumentTitle";

describe("roomTitle", () => {
  it("룸 이름이 있으면 앞에 붙인다", () => {
    expect(roomTitle("안개 낀 저택", "밤의 탁자")).toBe("안개 낀 저택 · 밤의 탁자");
  });
  it("없거나 비었으면 서비스 이름만", () => {
    expect(roomTitle(null, "밤의 탁자")).toBe("밤의 탁자");
    expect(roomTitle("  ", "밤의 탁자")).toBe("밤의 탁자");
  });
});
