import { describe, expect, it } from "vitest";
import { groupSummary, opposedRank, opposedSummary, resolveOpposed, type GroupEntry, type OpposedInput, type OpposedSideOutcome } from "./opposed";
import type { SuccessLevel } from "./dice";

const side = (level: SuccessLevel, value = 50, characteristic = false): OpposedInput => ({ level, value, characteristic });
const LEVELS: SuccessLevel[] = ["fumble", "failure", "regular", "hard", "extreme", "critical"];

describe("resolveOpposed", () => {
  it("성공 단계가 높은 쪽이 이긴다 (모든 조합)", () => {
    for (const la of LEVELS) {
      for (const lb of LEVELS) {
        const r = resolveOpposed(side(la), side(lb));
        const ra = opposedRank(la);
        const rb = opposedRank(lb);
        if (ra === 0 && rb === 0) expect(r).toEqual({ winner: "none", reason: "bothFail" });
        else if (ra > rb) expect(r).toEqual({ winner: "a", reason: "level" });
        else if (rb > ra) expect(r).toEqual({ winner: "b", reason: "level" });
        else expect(r.winner).toBe("tie"); // 값이 같으니 비김
      }
    }
  });

  it("한쪽만 성공하면 성공한 쪽이 이긴다 (대실패와 실패는 같은 실패)", () => {
    expect(resolveOpposed(side("regular"), side("failure"))).toEqual({ winner: "a", reason: "level" });
    expect(resolveOpposed(side("fumble"), side("regular"))).toEqual({ winner: "b", reason: "level" });
    expect(resolveOpposed(side("failure"), side("hard"))).toEqual({ winner: "b", reason: "level" });
  });

  it("둘 다 실패(대실패 포함)면 아무도 이기지 못한다", () => {
    expect(resolveOpposed(side("failure"), side("failure"))).toEqual({ winner: "none", reason: "bothFail" });
    expect(resolveOpposed(side("fumble"), side("failure"))).toEqual({ winner: "none", reason: "bothFail" });
    expect(resolveOpposed(side("fumble"), side("fumble"))).toEqual({ winner: "none", reason: "bothFail" });
  });

  it("단계가 같으면 기능 값이 높은 쪽이 이긴다", () => {
    expect(resolveOpposed(side("hard", 70), side("hard", 60))).toEqual({ winner: "a", reason: "value" });
    expect(resolveOpposed(side("hard", 55), side("hard", 60))).toEqual({ winner: "b", reason: "value" });
    expect(resolveOpposed(side("critical", 30), side("critical", 80))).toEqual({ winner: "b", reason: "value" });
  });

  it("단계도 값도 같으면 비김(다시 굴림)", () => {
    expect(resolveOpposed(side("regular", 60), side("regular", 60))).toEqual({ winner: "tie", reason: "tie" });
  });

  it("양쪽 다 특성치 판정이고 단계가 같으면 값과 상관없이 비김(다시 굴림)", () => {
    expect(resolveOpposed(side("regular", 70, true), side("regular", 60, true))).toEqual({ winner: "tie", reason: "tie" });
  });

  it("한쪽만 특성치면 값을 비교한다", () => {
    expect(resolveOpposed(side("regular", 70, true), side("regular", 60, false))).toEqual({ winner: "a", reason: "value" });
  });

  it("단계가 다르면 특성치끼리여도 높은 단계가 이긴다", () => {
    expect(resolveOpposed(side("hard", 40, true), side("regular", 90, true))).toEqual({ winner: "a", reason: "level" });
  });

  it("순위: 실패·대실패 0, 보통 1, 어려움 2, 극단 3, 대성공 4", () => {
    expect(LEVELS.map(opposedRank)).toEqual([0, 0, 1, 2, 3, 4]);
  });
});

const so = (character: string, level: SuccessLevel, target = 50): OpposedSideOutcome => ({
  characterId: character,
  character,
  name: "기능",
  target,
  percent: { units: 0, tens: [0], chosenTens: 0, bonus: 0, total: 10 },
  level,
});

describe("opposedSummary", () => {
  it("이긴 쪽 이름에 조사를 맞춘다", () => {
    expect(opposedSummary(so("윤서하", "hard"), so("광신도", "regular"), "a", "level")).toBe("윤서하가 이겼어요 (어려운 성공 대 성공).");
    expect(opposedSummary(so("윤서하", "failure"), so("광신도", "regular"), "b", "level")).toBe("광신도가 이겼어요 (성공 대 실패).");
    expect(opposedSummary(so("윤서하", "regular", 70), so("광신도", "regular", 60), "a", "value")).toBe("윤서하가 이겼어요 (둘 다 성공, 기능 값 70 대 60).");
  });
  it("둘 다 실패하면 방어하는 쪽이 유리하다고 알린다", () => {
    expect(opposedSummary(so("윤서하", "failure"), so("광신도", "fumble"), "none", "bothFail")).toBe("둘 다 실패했어요. 아무도 이기지 못하고 지금 상태가 이어져요(광신도가 유리해요).");
  });
  it("비기면 다시 굴리라고 알린다", () => {
    expect(opposedSummary(so("a", "regular"), so("b", "regular"), "tie", "tie")).toContain("다시 굴려요");
  });
});

const entry = (character: string, success: boolean): GroupEntry => ({
  characterId: character,
  character,
  target: 50,
  percent: { units: 0, tens: [0], chosenTens: 0, bonus: 0, total: 10 },
  level: success ? "regular" : "failure",
  success,
});

describe("groupSummary", () => {
  it("모두 성공", () => {
    expect(groupSummary("관찰력", [entry("A", true), entry("B", true)])).toBe("2명 모두 성공했어요.");
  });
  it("일부 실패는 이름을 적는다", () => {
    expect(groupSummary("관찰력", [entry("A", true), entry("B", false), entry("C", false)])).toBe("3명 중 1명이 성공했어요. 실패: B, C.");
  });
  it("전원 실패", () => {
    expect(groupSummary("관찰력", [entry("A", false)])).toBe("1명 중 0명이 성공했어요. 실패: A.");
  });
  it("기능이 없어 빠진 사람을 알린다", () => {
    expect(groupSummary("관찰력", [entry("A", true)], ["B"])).toBe("1명이 성공했어요. 관찰력이 없어서 빠진 사람: B.");
  });
  it("굴린 사람이 없으면 안내한다", () => {
    expect(groupSummary("관찰력", [])).toBe("관찰력을 굴릴 수 있는 캐릭터가 없어요.");
  });
});
