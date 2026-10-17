import { describe, expect, it } from "vitest";
import type { GameObject, Handout, Scene } from "@coc-vtt/shared";
import { buildCues, filterCues } from "./cues";
import { assignSlot, clearSlot, emptySlots, parseSlots } from "./slots";

const scenes: Scene[] = [{ id: "main", name: "현관" }, { id: "s2", name: "서재" }];
const handouts: Handout[] = [
  { id: "h1", title: "낡은 편지", body: "", visibleTo: "all", rev: 0 },
  { id: "h2", title: "찢어진 일기", body: "", visibleTo: "gm", rev: 0 },
];
const objects = [
  { id: "o1", name: "책장", layer: "object" },
  { id: "o2", name: "비밀 문", layer: "gm" },
] as GameObject[];
const cues = buildCues({ scenes, activeSceneId: "main", handouts, objects });

describe("buildCues", () => {
  it("활성 장면은 전환 대상에서 빠지고 나머지는 컷·페이드 두 가지가 나온다", () => {
    expect(cues.filter((c) => c.group === "scene").map((c) => c.id)).toEqual(["scene:s2:cut", "scene:s2:fade"]);
  });
  it("공개된 핸드아웃은 펼치기, 초안은 전원 공개 동작이 된다", () => {
    expect(cues.find((c) => c.id === "handout:h1")?.command).toEqual({ type: "handout.show", data: { id: "h1" } });
    expect(cues.find((c) => c.id === "handout:h2:publish")?.command).toEqual({ type: "handout.update", data: { id: "h2", visibleTo: "all" } });
  });
  it("오브젝트는 지금 상태의 반대로 바꾸는 동작이 된다", () => {
    expect(cues.find((c) => c.id === "object:o1")?.command).toEqual({ type: "object.update", data: { id: "o1", layer: "gm" } });
    expect(cues.find((c) => c.id === "object:o2")?.command).toEqual({ type: "object.update", data: { id: "o2", layer: "object" } });
  });
  it("id는 대상 id로 만들어져 이름을 바꿔도 같다", () => {
    const renamed = buildCues({ scenes: [{ id: "main", name: "x" }, { id: "s2", name: "다락방" }], activeSceneId: "main", handouts: [], objects: [] });
    expect(renamed.map((c) => c.id)).toEqual(["scene:s2:cut", "scene:s2:fade"]);
  });
});

describe("filterCues", () => {
  it("빈 검색어는 전부, 단어는 모두 포함한 것만", () => {
    expect(filterCues(cues, "")).toHaveLength(cues.length);
    expect(filterCues(cues, "서재").map((c) => c.id)).toEqual(["scene:s2:cut", "scene:s2:fade"]);
    expect(filterCues(cues, "서재 페이드").map((c) => c.id)).toEqual(["scene:s2:fade"]);
    expect(filterCues(cues, "없는말")).toEqual([]);
  });
  it("영어 키워드와 대소문자 무시", () => {
    expect(filterCues(cues, "FADE")).toHaveLength(1);
    expect(filterCues(cues, "handout").length).toBe(2);
  });
  it("이름이 검색어로 시작하는 항목이 먼저 온다", () => {
    const list = buildCues({ scenes: [{ id: "main", name: "a" }], activeSceneId: "main", handouts: [], objects: [{ id: "1", name: "큰 책장", layer: "object" }, { id: "2", name: "책상", layer: "object" }] as GameObject[] });
    expect(filterCues(list, "책").map((c) => c.id)).toEqual(["object:2", "object:1"]);
  });
});

describe("slots", () => {
  it("빈 칸에 넣고 비울 수 있다", () => {
    let s = assignSlot(emptySlots(), 0, "a");
    expect(s[0]).toBe("a");
    s = clearSlot(s, 0);
    expect(s[0]).toBeNull();
  });
  it("같은 동작을 다른 칸에 넣으면 옮겨진다", () => {
    const s = assignSlot(assignSlot(emptySlots(), 0, "a"), 3, "a");
    expect(s[0]).toBeNull();
    expect(s[3]).toBe("a");
  });
  it("범위 밖 칸은 무시한다", () => {
    const s = emptySlots();
    expect(assignSlot(s, 9, "a")).toBe(s);
    expect(assignSlot(s, -1, "a")).toBe(s);
  });
  it("깨진 저장값은 빈 9칸으로 읽는다", () => {
    expect(parseSlots("{oops")).toEqual(emptySlots());
    expect(parseSlots(null)).toEqual(emptySlots());
    expect(parseSlots('{"a":1}')).toEqual(emptySlots());
    expect(parseSlots('["x", 5, null]')).toEqual(["x", null, null, null, null, null, null, null, null]);
  });
});
