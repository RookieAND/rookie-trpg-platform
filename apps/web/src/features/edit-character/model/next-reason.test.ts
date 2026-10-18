import { describe, expect, it } from "vitest";
import { nextBlockReason, type WizardState } from "./next-reason";

const ok: WizardState = { step: 0, name: "서하", ageOk: true, baseOk: true, cutError: null, eduPending: false, pointErrors: [] };

describe("nextBlockReason", () => {
  it("막힌 게 없으면 null", () => {
    for (const step of [0, 1, 2, 3]) expect(nextBlockReason({ ...ok, step })).toBeNull();
  });
  it("1단계: 이름과 나이", () => {
    expect(nextBlockReason({ ...ok, name: "  " })).toContain("이름");
    expect(nextBlockReason({ ...ok, ageOk: false })).toContain("나이");
  });
  it("2단계: 교육 향상 판정이 남았으면 그 이유를 말한다", () => {
    expect(nextBlockReason({ ...ok, step: 1, eduPending: true })).toContain("교육 향상 판정");
    expect(nextBlockReason({ ...ok, step: 1, cutError: "합계 5를 맞춰 주세요." })).toBe("합계 5를 맞춰 주세요.");
    expect(nextBlockReason({ ...ok, step: 1, baseOk: false })).toContain("1~99");
  });
  it("3단계: 포인트 오류의 첫 줄", () => {
    expect(nextBlockReason({ ...ok, step: 2, pointErrors: ["직업 포인트를 넘었어요.", "b"] })).toContain("직업 포인트를 넘었어요.");
  });
  it("다른 단계의 문제는 보지 않는다", () => {
    expect(nextBlockReason({ ...ok, step: 3, eduPending: true, name: "" })).toBeNull();
  });
});
