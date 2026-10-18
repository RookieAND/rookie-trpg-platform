import { describe, expect, it } from "vitest";
import { damageToastText } from "./damage-toast";

const base = { name: "윤서하", amount: 8, armor: 0, dealt: 8, hpBefore: 12, hp: 4, kind: "wounded" as const, massive: false, conRoll: false };

describe("피해 적용 토스트", () => {
  it("일반 피해: 줄어든 HP를 보여 준다", () => {
    expect(damageToastText(base)).toBe("윤서하에게 피해 8만큼 적용했어요 · HP 12 → 4");
  });
  it("방어구가 있으면 함께 적는다", () => {
    expect(damageToastText({ ...base, armor: 3, dealt: 5, hp: 7 })).toBe("윤서하에게 피해 5만큼 적용했어요 (방어구 3) · HP 12 → 7");
  });
  it("방어구가 모두 막으면 받침에 맞는 조사로 알린다", () => {
    expect(damageToastText({ ...base, dealt: 0, armor: 9, hp: 12 })).toBe("윤서하는 피해를 받지 않았어요");
    expect(damageToastText({ ...base, name: "한도윤", dealt: 0, hp: 12 })).toBe("한도윤은 피해를 받지 않았어요");
  });
  it("중상·기절·빈사·사망 꼬리표", () => {
    expect(damageToastText({ ...base, kind: "major", conRoll: true })).toContain("중상이에요. 건강 판정(CON)을 해요");
    expect(damageToastText({ ...base, hp: 0, kind: "unconscious" })).toMatch(/기절했어요$/);
    expect(damageToastText({ ...base, hp: 0, kind: "dying" })).toMatch(/빈사 상태예요$/);
    expect(damageToastText({ ...base, hp: 0, kind: "dead", massive: true })).toMatch(/사망했어요$/);
  });
});
