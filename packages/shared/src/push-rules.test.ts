import { describe, expect, it } from "vitest";
import { luckBlockReason, pushBlockReason, type RollRuleInput } from "./push-rules";
import { parseCommand, runCommand } from "./dice";

const roll = (expr: string, a: number, b: number) => {
  const p = parseCommand(expr);
  if (!p.ok) throw new Error(p.error);
  const seq = [a, b];
  let i = 0;
  return runCommand(p.command, expr, () => seq[i++ % 2]!);
};
const base = (over: Partial<RollRuleInput> = {}): RollRuleInput => ({
  name: "관찰력",
  outcome: roll("CC<=60", 0.9, 0.8), // 89 실패
  isPush: false,
  pushed: false,
  luckUsed: false,
  weaponSkills: [],
  ...over,
});

describe("pushBlockReason", () => {
  it("일반 실패는 푸시할 수 있다", () => expect(pushBlockReason(base())).toBeNull());
  it("행운·SAN·전투 판정은 막는다", () => {
    expect(pushBlockReason(base({ name: "행운" }))).toMatch(/행운 판정/);
    expect(pushBlockReason(base({ name: "SAN" }))).toMatch(/SAN/);
    expect(pushBlockReason(base({ name: "맨손 격투" }))).toMatch(/전투/);
    expect(pushBlockReason(base({ name: "사격(권총)" }))).toMatch(/전투/);
    expect(pushBlockReason(base({ name: "투척", weaponSkills: ["투척"] }))).toMatch(/전투/);
  });
  it("푸시한 굴림·이미 푸시한 굴림·행운을 쓴 굴림은 막는다", () => {
    expect(pushBlockReason(base({ isPush: true }))).toMatch(/다시 푸시/);
    expect(pushBlockReason(base({ pushed: true }))).toMatch(/이미 푸시/);
    expect(pushBlockReason(base({ luckUsed: true }))).toMatch(/행운을 쓴/);
  });
  it("대실패는 막는다", () => {
    expect(pushBlockReason(base({ outcome: roll("CC<=40", 0.6, 0.9) }))).toMatch(/대실패/); // 96, 기능 40
    expect(pushBlockReason(base({ outcome: roll("CC<=60", 0.6, 0.9) }))).toBeNull(); // 96, 기능 60은 대실패 아님
  });
  it("성공한 굴림은 막는다", () => expect(pushBlockReason(base({ outcome: roll("CC<=60", 0.3, 0.2) }))).toMatch(/실패한/));
});

describe("luckBlockReason", () => {
  it("일반 실패는 행운을 쓸 수 있고, 전투 판정도 쓸 수 있다", () => {
    expect(luckBlockReason(base())).toBeNull();
    expect(luckBlockReason(base({ name: "사격(권총)" }))).toBeNull();
  });
  it("푸시한 굴림, 푸시의 원래 굴림, 행운·SAN 판정은 막는다", () => {
    expect(luckBlockReason(base({ isPush: true }))).toMatch(/푸시한 굴림/);
    expect(luckBlockReason(base({ pushed: true }))).toMatch(/푸시한 굴림/);
    expect(luckBlockReason(base({ name: "행운" }))).toMatch(/행운 판정/);
    expect(luckBlockReason(base({ name: "SAN" }))).toMatch(/SAN/);
    expect(luckBlockReason(base({ luckUsed: true }))).toMatch(/이미 행운/);
  });
});
