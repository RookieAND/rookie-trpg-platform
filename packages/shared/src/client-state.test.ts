import { describe, expect, it } from "vitest";
import { applyServerMessage, initialRoomState } from "./client-state";
import { DEFAULT_EFFECTS, type GameObject, ServerMessage, Snapshot } from "./protocol";

const obj = (over: Partial<GameObject> = {}): GameObject => ({
  id: "o1",
  sceneId: "main",
  kind: "token",
  name: "윤서하",
  x: 0,
  y: 0,
  layer: "object",
  visibleTo: "all",
  locked: false,
  rev: 0,
  ...over,
});

const snap = (over: Partial<Snapshot> = {}): ServerMessage => ({
  seq: 0,
  event: {
    type: "snapshot",
    data: { roomId: "r", seq: 5, sessionStatus: "ACTIVE", sessionNumber: 3, objects: [obj()], members: [], rolls: [], characters: [], scenes: [{ id: "main", name: "장면 1" }], activeSceneId: "main", effects: DEFAULT_EFFECTS, handouts: [], madnessTable: [],
    initiative: null,
    flow: null,
    audioLibrary: [],
    bgm: null,
    now: 0, ...over },
  },
});

describe("board.pinged", () => {
  const ping = (id: string): ServerMessage => ({ seq: 5, event: { type: "board.pinged", data: { id, userId: "u", userName: "서하", x: 1, y: 2, sceneId: "main", at: 1 } } });
  it("핑을 쌓되 같은 id는 한 번만, 최근 8개까지만 둔다", () => {
    let s = applyServerMessage(initialRoomState("r"), ping("a"));
    s = applyServerMessage(s, ping("a"));
    expect(s.pings).toHaveLength(1);
    for (let i = 0; i < 10; i++) s = applyServerMessage(s, ping(`p${i}`));
    expect(s.pings).toHaveLength(8);
    expect(s.pings.at(-1)?.id).toBe("p9");
  });
  it("새로 접속(snapshot)하면 핑이 비워진다", () => {
    const s = applyServerMessage(applyServerMessage(initialRoomState("r"), ping("a")), snap());
    expect(s.pings).toEqual([]);
  });
});

describe("applyServerMessage", () => {
  it("snapshot으로 상태를 통째로 맞춘다", () => {
    const s = applyServerMessage(initialRoomState(), snap());
    expect(s.ready).toBe(true);
    expect(s.lastSeq).toBe(5);
    expect(s.sessionNumber).toBe(3);
    expect(Object.keys(s.objects)).toEqual(["o1"]);
  });

  it("이동 이벤트를 적용하고 lastSeq를 올린다", () => {
    let s = applyServerMessage(initialRoomState(), snap());
    s = applyServerMessage(s, { seq: 6, event: { type: "object.updated", data: obj({ x: 50, rev: 1 }) } });
    expect(s.objects.o1).toMatchObject({ x: 50, rev: 1 });
    expect(s.lastSeq).toBe(6);
  });

  it("오래된 rev의 이벤트는 무시한다", () => {
    let s = applyServerMessage(initialRoomState(), snap());
    s = applyServerMessage(s, { seq: 7, event: { type: "object.updated", data: obj({ x: 90, rev: 2 }) } });
    s = applyServerMessage(s, { seq: 6, event: { type: "object.updated", data: obj({ x: 50, rev: 1 }) } });
    expect(s.objects.o1).toMatchObject({ x: 90, rev: 2 });
    expect(s.lastSeq).toBe(7);
  });

  it("같은 굴림을 두 번 받아도 한 번만 기록한다", () => {
    const entry = {
      id: "r1",
      userId: "u",
      userName: "윤서하",
      expr: "1d100",
      outcome: { kind: "dice" as const, expr: "1d100", rolls: [30], modifier: 0, total: 30 },
      session: 1,
      secret: false,
      at: 1,
    };
    let s = applyServerMessage(initialRoomState(), snap());
    s = applyServerMessage(s, { seq: 6, event: { type: "roll.result", data: entry } });
    s = applyServerMessage(s, { seq: 6, event: { type: "roll.result", data: entry } });
    expect(s.rolls).toHaveLength(1);
  });

  it("오브젝트 제거, 시작, 일시정지, 재개, 종료", () => {
    let s = applyServerMessage(initialRoomState(), snap());
    s = applyServerMessage(s, { seq: 6, event: { type: "object.removed", data: { id: "o1" } } });
    expect(s.objects).toEqual({});
    s = applyServerMessage(s, { seq: 6, event: { type: "session.started", data: { number: 4 } } });
    expect(s).toMatchObject({ sessionStatus: "ACTIVE", sessionNumber: 4 });
    s = applyServerMessage(s, { seq: 7, event: { type: "session.paused", data: { reason: "kp_disconnected" } } });
    expect(s.sessionStatus).toBe("PAUSED");
    s = applyServerMessage(s, { seq: 8, event: { type: "session.resumed", data: {} } });
    expect(s.sessionStatus).toBe("ACTIVE");
    s = applyServerMessage(s, { seq: 9, event: { type: "session.ended", data: {} } });
    expect(s.sessionStatus).toBe("IDLE");
  });

  it("KP 유예(kp.away)는 정지 없이 끊긴 시각만 기록하고, 돌아오거나 정지되면 사라진다", () => {
    let s = applyServerMessage(initialRoomState(), snap());
    s = applyServerMessage(s, { seq: 6, event: { type: "session.started", data: { number: 1 } } });
    s = applyServerMessage(s, { seq: 7, event: { type: "kp.away", data: { since: 1234 } } });
    expect(s).toMatchObject({ sessionStatus: "ACTIVE", kpAwaySince: 1234 });
    s = applyServerMessage(s, { seq: 8, event: { type: "kp.back", data: {} } });
    expect(s.kpAwaySince).toBeNull();
    s = applyServerMessage(s, { seq: 9, event: { type: "kp.away", data: { since: 2000 } } });
    s = applyServerMessage(s, { seq: 10, event: { type: "session.paused", data: { reason: "kp_disconnected" } } });
    expect(s).toMatchObject({ sessionStatus: "PAUSED", pauseReason: "kp_disconnected", kpAwaySince: null });
    s = applyServerMessage(s, { seq: 11, event: { type: "session.resumed", data: {} } });
    expect(s).toMatchObject({ sessionStatus: "ACTIVE", pauseReason: null });
  });

  it("오류는 seq를 건드리지 않고 기록만 한다", () => {
    let s = applyServerMessage(initialRoomState(), snap());
    s = applyServerMessage(s, { seq: 0, event: { type: "error", data: { code: "paused", message: "멈춤" } } });
    expect(s.lastSeq).toBe(5);
    expect(s.lastError?.code).toBe("paused");
  });

  it("재접속 snapshot은 오류와 비밀 굴림 알림을 비운다", () => {
    let s = applyServerMessage(initialRoomState(), snap());
    s = applyServerMessage(s, { seq: 6, event: { type: "roll.hidden", data: { id: "h", userId: "k", userName: "하늘", at: 1 } } });
    s = applyServerMessage(s, { seq: 0, event: { type: "error", data: { code: "paused", message: "x" } } });
    s = applyServerMessage(s, snap({ seq: 10 }));
    expect(s.hiddenRolls).toEqual([]);
    expect(s.lastError).toBeNull();
    expect(s.lastSeq).toBe(10);
  });

  it("장면 전환: 오브젝트 목록이 오면 통째로 바꾸고 전환 신호를 올린다", () => {
    let s = applyServerMessage(initialRoomState(), snap());
    const next = obj({ id: "o2", sceneId: "s2", name: "책장" });
    s = applyServerMessage(s, { seq: 6, event: { type: "scene.activated", data: { scene: { id: "s2", name: "서재" }, transition: "fade", objects: [next] } } });
    expect(s.activeSceneId).toBe("s2");
    expect(Object.keys(s.objects)).toEqual(["o2"]);
    expect(Object.keys(s.scenes)).toEqual(["s2"]);
    expect(s.transition).toEqual({ kind: "fade", n: 1 });
    s = applyServerMessage(s, { seq: 7, event: { type: "scene.activated", data: { scene: { id: "main", name: "장면 1" }, transition: "cut" } } });
    expect(s.transition?.n).toBe(2);
  });

  it("KP는 목록 없이 활성 장면만 바뀌고, 장면을 지우면 그 오브젝트도 정리한다", () => {
    let s = applyServerMessage(initialRoomState(), snap());
    s = applyServerMessage(s, { seq: 6, event: { type: "scene.added", data: { id: "s2", name: "서재" } } });
    s = applyServerMessage(s, { seq: 7, event: { type: "object.added", data: obj({ id: "o2", sceneId: "s2" }) } });
    s = applyServerMessage(s, { seq: 8, event: { type: "scene.activated", data: { scene: { id: "s2", name: "서재" }, transition: "cut" } } });
    expect(Object.keys(s.objects).sort()).toEqual(["o1", "o2"]);
    s = applyServerMessage(s, { seq: 9, event: { type: "scene.removed", data: { id: "s2" } } });
    expect(Object.keys(s.objects)).toEqual(["o1"]);
  });

  it("핸드아웃 펼치기", () => {
    let s = applyServerMessage(initialRoomState(), snap());
    s = applyServerMessage(s, { seq: 6, event: { type: "handout.shown", data: { id: "h1" } } });
    s = applyServerMessage(s, { seq: 6, event: { type: "handout.shown", data: { id: "h1" } } });
    expect(s.spotlight).toEqual({ id: "h1", n: 2 });
  });
});
