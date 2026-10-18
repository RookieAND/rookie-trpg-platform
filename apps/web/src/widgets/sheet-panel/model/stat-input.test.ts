import { describe, expect, it } from "vitest";
import { parseStatInput, stepDelta } from "./stat-input";

describe("parseStatInput", () => {
  it("그냥 숫자는 그 값으로 맞춘다", () => {
    expect(parseStatInput("7", 10, 12)).toEqual({ value: 7 });
    expect(parseStatInput(" 0 ", 10, 12)).toEqual({ value: 0 });
  });
  it("+/-는 더하고 뺀다", () => {
    expect(parseStatInput("-7", 10, 12)).toEqual({ delta: -7 });
    expect(parseStatInput("+1", 10, 12)).toEqual({ delta: 1 });
    expect(parseStatInput("−3", 10, 12)).toEqual({ delta: -3 });
  });
  it("범위를 넘으면 0과 최대로 맞춘다", () => {
    expect(parseStatInput("-50", 10, 12)).toEqual({ delta: -10 });
    expect(parseStatInput("+50", 10, 12)).toEqual({ delta: 2 });
    expect(parseStatInput("99", 10, 12)).toEqual({ value: 12 });
  });
  it("바뀌는 게 없거나 숫자가 아니면 null", () => {
    expect(parseStatInput("10", 10, 12)).toBeNull();
    expect(parseStatInput("+5", 12, 12)).toBeNull();
    expect(parseStatInput("", 10, 12)).toBeNull();
    expect(parseStatInput("abc", 10, 12)).toBeNull();
    expect(parseStatInput("1.5", 10, 12)).toBeNull();
    expect(parseStatInput("--3", 10, 12)).toBeNull();
  });
});

describe("stepDelta", () => {
  it("가능한 만큼만 움직인다", () => {
    expect(stepDelta(-5, 3, 10)).toBe(-3);
    expect(stepDelta(5, 8, 10)).toBe(2);
    expect(stepDelta(5, 3, 10)).toBe(5);
  });
  it("이미 끝이면 null", () => {
    expect(stepDelta(-5, 0, 10)).toBeNull();
    expect(stepDelta(5, 10, 10)).toBeNull();
  });
});
