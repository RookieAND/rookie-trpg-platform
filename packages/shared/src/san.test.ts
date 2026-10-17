import { describe, expect, it } from "vitest";
import type { Rng } from "./dice";
import { parseSanLoss, resolveSanCheck } from "./san";

const seq = (...v: number[]): Rng => {
  let i = 0;
  return () => v[i++ % v.length]!;
};
// d100 = 10의 자리 + 일의 자리. rollPercent는 일의 자리를 먼저, 10의 자리를 다음에 굴린다(0.39 → 3, 0.99 → 9).
const day = { start: 60, lost: 0 };
const base = { int: 70, day };

describe("parseSanLoss", () => {
  it("성공 시/실패 시를 읽는다", () => {
    expect(parseSanLoss("0/1d6")).toMatchObject({ ok: true, success: { kind: "fixed", n: 0 }, failure: { kind: "dice", count: 1, sides: 6 } });
    expect(parseSanLoss("1d3/1d10+1")).toMatchObject({ ok: true });
  });
  it("형식이 틀리면 거절한다", () => {
    for (const bad of ["1d6", "a/b", "0/1d6/2", "CC/1d6", "0/"]) expect(parseSanLoss(bad).ok).toBe(false);
  });
});

describe("resolveSanCheck", () => {
  it("성공하면 성공 손실만 잃는다", () => {
    // 일의 자리 0.3→3, 10의 자리 0.2→2: 23 ≤ 60 성공. 성공 손실 고정 1.
    const r = resolveSanCheck({ ...base, rng: seq(0.3, 0.2), expr: "1/1d6", san: 60 });
    expect(r.ok && r.outcome).toMatchObject({ success: true, loss: 1, before: 60, after: 59 });
  });

  it("실패하면 실패 손실을 굴린다", () => {
    // 일의 자리 0.9→9, 10의 자리 0.8→8: 89 > 60 실패. d6 0.5→4.
    const r = resolveSanCheck({ ...base, rng: seq(0.9, 0.8, 0.5), expr: "0/1d6", san: 60 });
    expect(r.ok && r.outcome).toMatchObject({ success: false, loss: 4, after: 56 });
    expect(r.ok && r.outcome.int).toBeUndefined();
  });

  it("대실패(100)는 실패 손실의 최댓값을 잃는다", () => {
    // 일의 자리 0, 10의 자리 0 → 100
    const r = resolveSanCheck({ ...base, rng: seq(0, 0), expr: "0/1d6", san: 60 });
    expect(r.ok && r.outcome).toMatchObject({ level: "fumble", loss: 6 });
  });

  it("5 이상 잃으면 INT 판정을 하고 성공하면 일시적 광기", () => {
    // 실패(89) → 1d10 0.6→7 잃음. INT 판정: 일의 자리 0.1→1, 10의 자리 0.1→1 = 11 ≤ 70 성공.
    const r = resolveSanCheck({ ...base, rng: seq(0.9, 0.8, 0.6, 0.1, 0.1), expr: "0/1d10", san: 60 });
    expect(r.ok && r.outcome).toMatchObject({ loss: 7, int: { roll: 11, target: 70, success: true }, madness: "temporary" });
  });

  it("INT 판정에 실패하면 광기가 없다", () => {
    // INT 판정 89 > 70 실패
    const r = resolveSanCheck({ ...base, rng: seq(0.9, 0.8, 0.6, 0.9, 0.8), expr: "0/1d10", san: 60, day: { start: 100, lost: 0 } });
    expect(r.ok && r.outcome.madness).toBeUndefined();
  });

  it("하루 손실이 하루 시작 SAN의 1/5 이상이면 장기 광기", () => {
    // 시작 60 → 기준 12. 이미 10 잃었고 이번에 4 잃어 14.
    const r = resolveSanCheck({ ...base, rng: seq(0.9, 0.8, 0.5), expr: "0/1d6", san: 50, day: { start: 60, lost: 10 } });
    expect(r.ok && r.outcome).toMatchObject({ dailyLoss: 14, madness: "indefinite" });
  });

  it("SAN이 0이 되면 영구 광기이고 음수로 내려가지 않는다", () => {
    const r = resolveSanCheck({ ...base, rng: seq(0.9, 0.8, 0.99), expr: "0/1d10", san: 3 });
    expect(r.ok && r.outcome).toMatchObject({ loss: 3, after: 0, madness: "permanent" });
  });

  it("손실 0이면 아무 일도 없다", () => {
    const r = resolveSanCheck({ ...base, rng: seq(0.3, 0.2), expr: "0/1d6", san: 60 });
    expect(r.ok && r.outcome).toMatchObject({ loss: 0, after: 60 });
    expect(r.ok && r.outcome.madness).toBeUndefined();
  });
});
