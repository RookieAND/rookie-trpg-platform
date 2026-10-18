import { describe, expect, it } from "vitest";
import { MARKER_DEFS, MARKERS_VISIBLE, type Marker } from "@coc-vtt/shared";
import { layoutBadges, shapePath } from "./marker-badges";

const m = (...keys: string[]): Marker[] => keys.map((key) => (key === "custom" ? { key, text: "함정" } : { key }));

describe("표식 배지 배치", () => {
  it("표식이 없으면 아무것도 그리지 않는다", () => {
    expect(layoutBadges(undefined, undefined, 24)).toMatchObject({ badges: [], more: 0 });
    expect(layoutBadges([], ["injured"], 24).badges).toEqual([]);
  });

  it("최대 4개까지 그리고 나머지는 +n으로 센다", () => {
    const l = layoutBadges(m("stun", "poison", "bleed", "fear", "madness", "hidden"), undefined, 24);
    expect(l.badges).toHaveLength(MARKERS_VISIBLE);
    expect(l.more).toBe(2);
    expect(l.moreAria).toBe("표식 2개 더 있음: 광기, 은신");
    // 자리가 겹치지 않는다
    const spots = new Set(l.badges.map((b) => `${b.dx},${b.dy}`));
    expect(spots.size).toBe(4);
  });

  it("스크린 리더 글에 상태 이름이 들어 있고, 비밀 표식은 GM만 보임이 붙는다", () => {
    const l = layoutBadges([{ key: "stun" }, { key: "poison", secret: true }, { key: "custom", text: "함정" }], undefined, 24);
    expect(l.badges.map((b) => b.aria)).toEqual(["상태 기절", "상태 중독, GM만 보임", "상태 함정"]);
    expect(l.badges[1]!.secret).toBe(true);
  });

  it("시트의 부상 칩이 같은 뜻을 보여 주면 기절·사망 표식은 겹쳐 그리지 않는다", () => {
    const l = layoutBadges(m("stun", "dead", "focus"), ["unconscious", "dead"], 24);
    expect(l.badges.map((b) => b.key)).toEqual(["focus"]);
    // 칩이 없으면 둘 다 그린다
    expect(layoutBadges(m("stun", "dead"), ["injured"], 24).badges.map((b) => b.key)).toEqual(["stun", "dead"]);
  });

  it("모르는 key(새 버전의 표식)도 일반 배지로 그린다", () => {
    const l = layoutBadges([{ key: "levitate" }], undefined, 24);
    expect(l.badges[0]).toMatchObject({ key: "levitate", label: "levitate", shape: "circle" });
  });
});

describe("표식은 색만으로 구분하지 않는다", () => {
  it("모양+기호+색 조합이 모두 다르고, 모양도 기호도 겹치지 않는다", () => {
    const combos = new Set(MARKER_DEFS.map((d) => `${d.shape}|${d.glyph}|${d.color}`));
    expect(combos.size).toBe(MARKER_DEFS.length);
    expect(new Set(MARKER_DEFS.map((d) => d.shape)).size).toBe(MARKER_DEFS.length);
    expect(new Set(MARKER_DEFS.map((d) => d.glyph)).size).toBe(MARKER_DEFS.length);
    expect(new Set(MARKER_DEFS.map((d) => d.color)).size).toBe(MARKER_DEFS.length);
  });

  it("경로를 쓰는 모양은 닫힌 경로를 만든다", () => {
    for (const d of MARKER_DEFS) {
      const p = shapePath(d.shape, 8);
      if (["circle", "square", "pill"].includes(d.shape)) expect(p).toBeNull();
      else expect(p).toMatch(/^M.*Z$/);
    }
  });
});
