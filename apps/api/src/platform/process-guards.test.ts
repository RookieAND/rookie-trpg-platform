import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./log";
import { installProcessGuards, type GuardTarget } from "./process-guards";

const setup = () => {
  const proc = new EventEmitter();
  const stop = vi.fn();
  const lines: Array<Record<string, unknown>> = [];
  installProcessGuards(stop, proc as unknown as GuardTarget, createLogger({ sink: (l) => void lines.push(JSON.parse(l)) }));
  return { proc, stop, lines };
};

describe("프로세스 안전망", () => {
  it("처리 안 된 거절은 기록만 하고 내리지 않는다", () => {
    const { proc, stop, lines } = setup();
    proc.emit("unhandledRejection", new Error("빠뜨린 catch password=pw1"));
    expect(stop).not.toHaveBeenCalled();
    expect(lines[0]).toMatchObject({ level: "error", msg: "unhandledRejection" });
    expect(JSON.stringify(lines)).not.toContain("pw1");
  });
  it("잡히지 않은 예외는 기록하고 종료 코드 1로 내려간다", () => {
    const { proc, stop, lines } = setup();
    proc.emit("uncaughtException", new Error("boom"));
    expect(stop).toHaveBeenCalledWith("uncaughtException", 1);
    expect(lines[0]).toMatchObject({ msg: "uncaughtException" });
  });
  it("SIGTERM과 SIGINT는 종료 코드 0", () => {
    const { proc, stop } = setup();
    proc.emit("SIGTERM");
    proc.emit("SIGINT");
    expect(stop.mock.calls).toEqual([
      ["SIGTERM", 0],
      ["SIGINT", 0],
    ]);
  });
});
