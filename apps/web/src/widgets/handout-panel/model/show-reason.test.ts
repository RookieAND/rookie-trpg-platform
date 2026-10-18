import { describe, expect, it } from "vitest";
import { showBlockReason } from "./show-reason";

describe("showBlockReason", () => {
  it("초안이면 공개하기를 안내한다", () => {
    expect(showBlockReason({ visibleTo: "gm" }, true)).toContain("공개하기");
  });
  it("일시정지 중이면 이어하기를 안내한다", () => {
    expect(showBlockReason({ visibleTo: "all" }, false)).toContain("이어하기");
  });
  it("공개된 핸드아웃은 막힌 이유가 없다", () => {
    expect(showBlockReason({ visibleTo: "all" }, true)).toBeNull();
    expect(showBlockReason({ visibleTo: ["a"] }, true)).toBeNull();
  });
  it("GM 노트는 펼치기 버튼 자체가 없으니 이유도 없다", () => {
    expect(showBlockReason({ visibleTo: "gm", kpOnly: true }, true)).toBeNull();
  });
});
