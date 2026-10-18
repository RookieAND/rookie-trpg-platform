import { describe, expect, it } from "vitest";
import { clientCommandSchema } from "./protocol";
import { MARKER_DEFS, MARKER_KEYS, applyMarker, dedupeMarkers, markerLabel, markersFor, sanitizeMarkers, splitMarkers } from "./markers";

describe("표식 정의", () => {
  it("열 가지이고 이름이 한국어로 정해져 있다", () => {
    expect(MARKER_KEYS).toHaveLength(10);
    expect(MARKER_DEFS.map((d) => d.label)).toEqual(["기절", "중독", "출혈", "공포", "광기", "은신", "집중", "도움 필요", "사망", "사용자 지정 1"]);
  });
});

describe("applyMarker", () => {
  it("켜고 끄고, 같은 key는 하나만 둔다", () => {
    const a = applyMarker(undefined, "stun", true)!;
    expect(a).toEqual([{ key: "stun" }]);
    expect(applyMarker(a, "stun", true)).toBeNull();
    expect(applyMarker(a, "stun", true, { secret: true })).toEqual([{ key: "stun", secret: true }]);
    expect(applyMarker(a, "stun", false)).toEqual([]);
    expect(applyMarker(a, "poison", false)).toBeNull();
    expect(applyMarker(a, "poison", true)).toEqual([{ key: "stun" }, { key: "poison" }]);
  });
  it("사용자 지정은 글을 8자로 자르고 글이 달라지면 바뀐 것으로 본다", () => {
    const a = applyMarker([], "custom", true, { text: "독이 든 술이에요 정말" })!;
    expect(a).toEqual([{ key: "custom", text: "독이 든 술이에요 " .trim().slice(0, 8) }]);
    expect(applyMarker(a, "custom", true, { text: "함정" })).toEqual([{ key: "custom", text: "함정" }]);
  });
});

describe("markersFor / sanitizeMarkers", () => {
  const list = [{ key: "stun" }, { key: "poison", secret: true }];
  it("GM은 전부, 나머지는 비밀이 아닌 것만", () => {
    expect(markersFor(list, "kp")).toHaveLength(2);
    for (const role of ["pl", "spectator"]) expect(markersFor(list, role)).toEqual([{ key: "stun" }]);
    expect(markersFor(undefined, "kp")).toEqual([]);
  });
  it("깨진 값은 버리고 모르는 key는 모양이 맞으면 남긴다", () => {
    expect(sanitizeMarkers([{ key: "levitate" }, { key: "x y" }, null, { key: "stun" }, { key: "stun", secret: true }, { key: "custom" }, { key: "custom", text: " 안녕 " }, "z"])).toEqual([{ key: "levitate" }, { key: "stun" }, { key: "custom", text: "안녕" }]);
    expect(sanitizeMarkers("nope")).toEqual([]);
    expect(sanitizeMarkers(Array.from({ length: 30 }, (_, i) => ({ key: `k${i}` })))).toHaveLength(10);
  });
  it("이름은 사용자 지정이면 글, 모르는 key는 key 그대로", () => {
    expect(markerLabel({ key: "fear" })).toBe("공포");
    expect(markerLabel({ key: "custom", text: "함정" })).toBe("함정");
    expect(markerLabel({ key: "levitate" })).toBe("levitate");
  });
});

describe("dedupeMarkers / splitMarkers", () => {
  it("부상 칩과 같은 뜻의 기절·사망만 뺀다", () => {
    const list = [{ key: "stun" }, { key: "dead" }, { key: "fear" }];
    expect(dedupeMarkers(list, ["unconscious"]).map((m) => m.key)).toEqual(["dead", "fear"]);
    expect(dedupeMarkers(list, ["dead"]).map((m) => m.key)).toEqual(["stun", "fear"]);
    expect(dedupeMarkers(list, ["injured", "majorWound"]).map((m) => m.key)).toEqual(["stun", "dead", "fear"]);
    expect(dedupeMarkers(list, undefined)).toHaveLength(3);
  });
  it("4개까지 보이고 나머지는 개수만", () => {
    expect(splitMarkers(MARKER_KEYS.map((key) => ({ key })))).toMatchObject({ more: 6 });
    expect(splitMarkers([{ key: "stun" }])).toEqual({ shown: [{ key: "stun" }], more: 0 });
  });
});

describe("object.marker 명령 모양", () => {
  const ok = (data: unknown) => clientCommandSchema.safeParse({ type: "object.marker", data }).success;
  it("알려진 key와 8자 이내의 글만 받는다", () => {
    expect(ok({ id: "t", key: "stun", on: true })).toBe(true);
    expect(ok({ id: "t", key: "custom", on: true, text: "함정" })).toBe(true);
    expect(ok({ id: "t", key: "custom", on: true, text: "아홉글자가넘어가요요" })).toBe(false);
    expect(ok({ id: "t", key: "levitate", on: true })).toBe(false);
    expect(ok({ id: "t", key: "stun" })).toBe(false);
  });
});
