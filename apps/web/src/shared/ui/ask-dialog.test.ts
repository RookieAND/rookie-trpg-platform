import { describe, expect, it } from "vitest";
import { promptResult } from "./ask-dialog";

describe("promptResult", () => {
  it("공백을 떼고 새 값을 돌려준다", () => {
    expect(promptResult("  지하실 ", "서재")).toBe("지하실");
  });
  it("비었거나 그대로면 null", () => {
    expect(promptResult("   ", "서재")).toBeNull();
    expect(promptResult("서재 ", "서재")).toBeNull();
  });
});
