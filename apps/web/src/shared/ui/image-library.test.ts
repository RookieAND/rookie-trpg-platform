import { describe, expect, it } from "vitest";
import { mergeLibrary, rememberId, roomImageIds } from "./image-library";

describe("rememberId", () => {
  it("새로 올린 id를 맨 앞에 두고 중복은 없앤다", () => {
    expect(rememberId(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(rememberId(["a"], "z")).toEqual(["z", "a"]);
  });
  it("최대 개수를 넘으면 오래된 것부터 버린다", () => {
    expect(rememberId(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

describe("mergeLibrary", () => {
  it("올린 것이 앞, 룸에서 쓰인 것이 뒤. 중복 없음", () => {
    expect(mergeLibrary(["b", "a"], ["a", "c", "d"])).toEqual(["b", "a", "c", "d"]);
  });
  it("개수 제한", () => {
    expect(mergeLibrary(["a"], ["b", "c", "d"], 2)).toEqual(["a", "b"]);
  });
});

describe("roomImageIds", () => {
  it("배경·오브젝트·핸드아웃의 이미지를 모으고 나중 것이 앞에 온다", () => {
    const ids = roomImageIds({ scenes: [{ background: "s1" }, {}], objects: [{ image: "o1" }, { image: "o2" }, {}], handouts: [{ image: "h1" }] });
    expect(ids).toEqual(["h1", "o2", "o1", "s1"]);
  });
  it("이미지가 없으면 빈 목록", () => {
    expect(roomImageIds({ scenes: [{}], objects: [], handouts: [] })).toEqual([]);
  });
});
