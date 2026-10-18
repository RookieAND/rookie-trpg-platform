import { describe, expect, it } from "vitest";
import { collectMediaIds } from "./media-refs";

const A = "a".repeat(32);
const B = "0123456789abcdef0123456789abcdef";

describe("collectMediaIds", () => {
  it("중첩된 곳의 이미지·오디오 id를 모은다", () => {
    const ids = collectMediaIds({ scenes: [{ background: A }], audio: [{ assetId: B }], handouts: [{ image: A }], note: "x" });
    expect([...ids].sort()).toEqual([A, B].sort());
  });
  it("UUID나 짧은 문자열은 잡지 않는다", () => {
    expect(collectMediaIds({ id: "3f2b8c1e-aaaa-bbbb-cccc-0123456789ab", s: "abc" }).size).toBe(0);
  });
  it("비어 있어도 안전하다", () => expect(collectMediaIds(null).size).toBe(0));
});
