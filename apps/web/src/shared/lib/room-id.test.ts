import { describe, expect, it } from "vitest";
import { isRoomId } from "./room-id";

describe("isRoomId", () => {
  it("서버가 만드는 id 모양만 통과", () => {
    expect(isRoomId("zxsRsEwhXgM")).toBe(true);
    expect(isRoomId("a_b-c")).toBe(true);
    expect(isRoomId("")).toBe(false);
    expect(isRoomId("a b")).toBe(false);
    expect(isRoomId("../x")).toBe(false);
    expect(isRoomId("가나다")).toBe(false);
    expect(isRoomId("a".repeat(65))).toBe(false);
  });
});
