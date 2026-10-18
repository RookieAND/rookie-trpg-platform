import { describe, expect, it } from "vitest";
import { playerGuideSteps, readGuideClosed, showPlayerGuide, writeGuideClosed } from "./player-guide";

const base = { role: "pl" as const, userId: "u1", characters: [], rolls: [], handouts: [] };
const done = (s: ReturnType<typeof playerGuideSteps>) => Object.fromEntries(s.map((x) => [x.key, x.done]));

describe("PL 시작 가이드 단계", () => {
  it("아무것도 안 했으면 모두 미완료", () => {
    expect(done(playerGuideSteps(base))).toEqual({ character: false, roll: false, handout: false, move: false });
  });
  it("내 캐릭터·내 굴림만 완료로 센다", () => {
    const s = playerGuideSteps({ ...base, characters: [{ ownerId: "u2" }], rolls: [{ userId: "u2" }] });
    expect(done(s).character).toBe(false);
    expect(done(s).roll).toBe(false);
    const t = playerGuideSteps({ ...base, characters: [{ ownerId: "u1" }], rolls: [{ userId: "u1" }], handouts: [{}] });
    expect(done(t)).toMatchObject({ character: true, roll: true, handout: true });
  });
  it("KP 전용 노트는 받은 핸드아웃으로 세지 않는다", () => {
    expect(done(playerGuideSteps({ ...base, handouts: [{ kpOnly: true }] })).handout).toBe(false);
  });
  it("관전자에게는 캐릭터·굴림 단계가 없다", () => {
    const keys = playerGuideSteps({ ...base, role: "spectator" }).map((s) => s.key);
    expect(keys).toEqual(["watch", "handout"]);
  });
});

describe("가이드 표시 조건", () => {
  const on = { role: "pl" as const, ready: true, sessionStatus: "IDLE", closed: false };
  it("대기 중인 PL·관전자에게만 보인다", () => {
    expect(showPlayerGuide(on)).toBe(true);
    expect(showPlayerGuide({ ...on, role: "spectator" })).toBe(true);
    expect(showPlayerGuide({ ...on, role: "kp" })).toBe(false);
  });
  it("접속 전, 세션 시작 뒤, 닫은 뒤에는 숨긴다", () => {
    expect(showPlayerGuide({ ...on, ready: false })).toBe(false);
    expect(showPlayerGuide({ ...on, sessionStatus: "ACTIVE" })).toBe(false);
    expect(showPlayerGuide({ ...on, closed: true })).toBe(false);
  });
});

describe("닫은 상태 저장", () => {
  it("룸 id마다 따로 기억한다", () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    writeGuideClosed("r1", st);
    expect(readGuideClosed("r1", st)).toBe(true);
    expect(readGuideClosed("r2", st)).toBe(false);
  });
  it("저장소가 던져도 정상 동작한다", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readGuideClosed("r1", bad)).toBe(false);
    expect(() => writeGuideClosed("r1", bad)).not.toThrow();
  });
});
