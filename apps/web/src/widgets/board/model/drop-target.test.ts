import { describe, expect, it } from "vitest";
import { objectAt, type HitObject } from "./drop-target";

const tok = (id: string, x: number, y: number): HitObject => ({ id, kind: "token", x, y });

describe("objectAt", () => {
  it("토큰 위의 점은 그 토큰, 빈 곳은 null", () => {
    const list = [tok("a", 100, 100)];
    expect(objectAt(list, 110, 105)).toBe("a");
    expect(objectAt(list, 100, 140)).toBeNull();
    expect(objectAt([], 0, 0)).toBeNull();
  });
  it("겹치면 위에 그려진(뒤쪽) 오브젝트가 이긴다", () => {
    expect(objectAt([tok("a", 100, 100), tok("b", 110, 100)], 105, 100)).toBe("b");
  });
  it("소품은 상자 모양으로 맞춘다: 그림이 없으면 납작하다", () => {
    const flat: HitObject = { id: "p", kind: "prop", x: 200, y: 200 };
    expect(objectAt([flat], 230, 210)).toBe("p");
    expect(objectAt([flat], 200, 230)).toBeNull();
    expect(objectAt([{ ...flat, image: "img" }], 200, 230)).toBe("p");
  });
});
