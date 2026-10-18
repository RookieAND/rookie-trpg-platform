import { describe, expect, it } from "vitest";
import { resolveOnBlur } from "./text-sync";

describe("resolveOnBlur", () => {
  it("입력 중 다른 쪽 변경이 없으면 내 글을 저장한다", () => {
    expect(resolveOnBlur({ base: "", local: "단서 메모", remote: "" })).toEqual({ commit: "단서 메모", next: "단서 메모" });
  });
  it("아무것도 안 고쳤으면 저장하지 않고 받은 값을 따른다", () => {
    expect(resolveOnBlur({ base: "옛 글", local: "옛 글", remote: "새 글" })).toEqual({ commit: null, next: "새 글" });
    expect(resolveOnBlur({ base: "글", local: "글", remote: "글" })).toEqual({ commit: null, next: "글" });
  });
  it("내가 쓰는 동안 같은 글이 도착했으면 그대로 둔다", () => {
    expect(resolveOnBlur({ base: "", local: "같은 글", remote: "같은 글" })).toEqual({ commit: null, next: "같은 글" });
  });
  it("둘 다 고쳤으면 내 글이 이긴다(저장 동작은 그대로)", () => {
    expect(resolveOnBlur({ base: "a", local: "내 글", remote: "남의 글" })).toEqual({ commit: "내 글", next: "내 글" });
  });
});
