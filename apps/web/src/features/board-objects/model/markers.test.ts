import { describe, expect, it } from "vitest";
import { canEditMarkers, markerCommand, markerRows } from "./markers";

describe("표식 명령", () => {
  it("켜기·끄기·비밀 여부가 명령에 실린다", () => {
    expect(markerCommand({ id: "t" }, "stun", true)).toEqual({ type: "object.marker", data: { id: "t", key: "stun", on: true } });
    expect(markerCommand({ id: "t" }, "stun", true, { secret: true })).toEqual({ type: "object.marker", data: { id: "t", key: "stun", on: true, secret: true } });
    expect(markerCommand({ id: "t" }, "stun", false, { secret: true })).toEqual({ type: "object.marker", data: { id: "t", key: "stun", on: false } });
  });
  it("사용자 지정은 글이 있어야 하고 8자로 자른다", () => {
    expect(markerCommand({ id: "t" }, "custom", true, { text: "  " })).toBeNull();
    expect(markerCommand({ id: "t" }, "custom", true, { text: "독이 든 술이에요 정말로" })).toMatchObject({ data: { text: "독이 든 술이에요 " .trim().slice(0, 8) } });
    expect(markerCommand({ id: "t" }, "custom", false)).toMatchObject({ data: { on: false } });
  });
});

describe("표식 패널", () => {
  it("열 개 줄을 만들고 켜진 것만 on이다", () => {
    const rows = markerRows([{ key: "poison", secret: true }, { key: "custom", text: "함정" }]);
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => r.on).map((r) => r.key)).toEqual(["poison", "custom"]);
    expect(rows.find((r) => r.key === "poison")).toMatchObject({ secret: true });
    expect(rows.find((r) => r.key === "custom")).toMatchObject({ text: "함정" });
  });
  it("GM은 모든 토큰, PL은 자기 토큰, 소품·관전자는 못 바꾼다", () => {
    expect(canEditMarkers("kp", "k", { kind: "token" })).toBe(true);
    expect(canEditMarkers("pl", "p1", { kind: "token", ownerId: "p1" })).toBe(true);
    expect(canEditMarkers("pl", "p1", { kind: "token", ownerId: "p2" })).toBe(false);
    expect(canEditMarkers("pl", "p1", { kind: "token" })).toBe(false);
    expect(canEditMarkers("kp", "k", { kind: "prop" })).toBe(false);
    expect(canEditMarkers("spectator", "s", { kind: "token", ownerId: "s" })).toBe(false);
  });
});
