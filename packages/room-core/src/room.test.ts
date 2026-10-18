import { describe, expect, it } from "vitest";
import type { ClientCommand, Rng } from "@coc-vtt/shared";
import { canSee, inAudience, Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const seo: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const han: Actor = { userId: "pl2", name: "한도윤", role: "pl" };
const spec: Actor = { userId: "sp1", name: "구경꾼", role: "spectator" };

let counter = 0;
const newRoom = (opts: ConstructorParameters<typeof Room>[1] = {}) =>
  new Room("room-1", { newId: () => `id-${++counter}`, ...opts });

const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) =>
  ({ type, data }) as ClientCommand;

/** 모두 접속시킨 룸 */
function setup(opts: ConstructorParameters<typeof Room>[1] = {}) {
  const room = newRoom(opts);
  for (const a of [kp, seo, han, spec]) room.join(a);
  room.handle(kp, { type: "session.start", data: {} });
  return room;
}

const received = (outs: Out[], viewer: Actor) => outs.filter((o) => inAudience(o.audience, viewer)).map((o) => o.event);

function must(r: ReturnType<Room["handle"]>) {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
}

const addToken = (room: Room, extra: Partial<{ name: string; ownerId: string; layer: "object" | "gm"; visibleTo: "all" | "gm" | string[] }> = {}) => {
  const outs = must(room.handle(kp, cmd("object.add", { kind: "token", name: "윤서하", x: 10, y: 20, layer: "object", visibleTo: "all", ...extra })));
  const added = outs.map((o) => o.event).find((e) => e.type === "object.added");
  if (!added || added.type !== "object.added") throw new Error("no add event");
  return added.data;
};

describe("접속과 일시정지", () => {
  it("GM 연결이 끊겨도 바로 멈추지 않고, 유예가 끝나야 자동 정지된다", () => {
    const room = setup();
    const outs = room.leave("kp1");
    expect(room.sessionStatus).toBe("ACTIVE");
    expect(outs.map((o) => o.event.type)).toEqual(["presence", "kp.away"]);
    const expired = room.expireKpAway();
    expect(room.sessionStatus).toBe("PAUSED");
    expect(expired.map((o) => o.event.type)).toEqual(["session.paused"]);
  });

  it("PL 연결이 끊겨도 세션은 계속된다", () => {
    const room = setup();
    room.leave("pl1");
    expect(room.sessionStatus).toBe("ACTIVE");
  });

  it("일시정지 중에는 보드 입력과 굴림이 막힌다", () => {
    const room = setup();
    const t = addToken(room, { ownerId: "pl1" });
    must(room.handle(kp, cmd("session.pause", {})));
    const move = room.handle(seo, cmd("object.move", { id: t.id, x: 1, y: 1, rev: t.rev }));
    expect(move).toMatchObject({ ok: false, code: "paused" });
    const roll = room.handle(seo, cmd("roll.request", { expr: "1d100", secret: false }));
    expect(roll).toMatchObject({ ok: false, code: "paused" });
  });

  it("GM이 직접 멈춘 세션은 GM이 돌아와도 풀리지 않고, 이어하기를 해야 진행된다", () => {
    const room = setup();
    const t = addToken(room, { ownerId: "pl1" });
    must(room.handle(kp, cmd("session.pause", {})));
    room.leave("kp1");
    room.expireKpAway();
    room.join(kp);
    expect(room.sessionStatus).toBe("PAUSED"); // 직접 누른 정지는 접속만으로 풀리지 않는다
    must(room.handle(kp, cmd("session.resume", {})));
    expect(room.sessionStatus).toBe("ACTIVE");
    expect(room.handle(seo, cmd("object.move", { id: t.id, x: 5, y: 5, rev: t.rev })).ok).toBe(true);
  });

  it("PL은 세션을 멈추거나 끝낼 수 없다", () => {
    const room = setup();
    expect(room.handle(seo, cmd("session.pause", {}))).toMatchObject({ ok: false, code: "forbidden" });
    expect(room.handle(seo, cmd("session.end", {}))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("세션 시작 전에는 PL의 굴림과 이동이 막히고 GM은 장면을 준비할 수 있다", () => {
    const room = newRoom();
    for (const a of [kp, seo]) room.join(a);
    expect(room.sessionStatus).toBe("IDLE");
    expect(room.handle(seo, cmd("roll.request", { expr: "1d100", secret: false }))).toMatchObject({ ok: false, code: "idle" });
    const t = addToken(room, { ownerId: "pl1" }); // GM 준비
    expect(room.handle(seo, cmd("object.move", { id: t.id, x: 1, y: 1, rev: t.rev }))).toMatchObject({ ok: false, code: "idle" });
    expect(room.handle(kp, cmd("roll.request", { expr: "1d100", secret: true })).ok).toBe(true);
  });

  it("세션 시작은 GM만, 번호는 1씩 오른다", () => {
    const room = newRoom();
    for (const a of [kp, seo]) room.join(a);
    expect(room.handle(seo, cmd("session.start", {}))).toMatchObject({ ok: false, code: "forbidden" });
    const outs = must(room.handle(kp, cmd("session.start", {})));
    expect(outs[0]?.event).toEqual({ type: "session.started", data: { number: 1 } });
    expect(room.handle(kp, cmd("session.start", {}))).toMatchObject({ ok: false, code: "bad_message" });
    must(room.handle(kp, cmd("session.end", {})));
    expect(room.sessionStatus).toBe("IDLE");
    must(room.handle(kp, cmd("session.start", {})));
    expect(room.snapshot(kp).sessionNumber).toBe(2);
  });

  it("종료한 뒤에도 보드와 굴림 기록은 남고, 굴림에는 세션 번호가 붙는다", () => {
    const room = setup({ rng: () => 0.25 });
    addToken(room);
    must(room.handle(seo, cmd("roll.request", { expr: "1d100", secret: false })));
    must(room.handle(kp, cmd("session.end", {})));
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(seo, cmd("roll.request", { expr: "1d100", secret: false })));
    const snap = room.snapshot(seo);
    expect(snap.objects).toHaveLength(1);
    expect(snap.rolls.map((r) => r.session)).toEqual([1, 2]);
  });

  it("이미 일시정지 중이거나 진행 중이 아닐 때의 중복 명령은 거절한다", () => {
    const room = setup();
    expect(room.handle(kp, cmd("session.resume", {}))).toMatchObject({ ok: false, code: "bad_message" });
    must(room.handle(kp, cmd("session.pause", {})));
    expect(room.handle(kp, cmd("session.pause", {}))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("참가하지 않은 사용자의 명령은 거절한다", () => {
    const room = setup();
    const stranger: Actor = { userId: "x", name: "낯선이", role: "kp" };
    expect(room.handle(stranger, cmd("session.end", {}))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("요청에 실린 역할이 아니라 서버가 아는 역할을 쓴다", () => {
    const room = setup();
    const forged: Actor = { userId: "pl1", name: "윤서하", role: "kp" };
    expect(room.handle(forged, cmd("session.end", {}))).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("오브젝트 권한과 보임 범위", () => {
  it("PL은 오브젝트를 추가할 수 없다", () => {
    const room = setup();
    const r = room.handle(seo, cmd("object.add", { kind: "token", name: "x", x: 0, y: 0, layer: "object", visibleTo: "all" }));
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("PL은 자기 토큰만 움직이고 다른 사람이 받는다", () => {
    const room = setup();
    const t = addToken(room, { ownerId: "pl1" });
    const outs = must(room.handle(seo, cmd("object.move", { id: t.id, x: 100, y: 200, rev: t.rev })));
    for (const viewer of [kp, seo, han, spec]) {
      const evs = received(outs, viewer);
      expect(evs).toHaveLength(1);
      expect(evs[0]).toMatchObject({ type: "object.updated", data: { x: 100, y: 200, rev: 1 } });
    }
    expect(room.handle(han, cmd("object.move", { id: t.id, x: 0, y: 0, rev: 1 }))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("잠긴 토큰은 주인도 움직일 수 없다", () => {
    const room = setup();
    const t = addToken(room, { ownerId: "pl1" });
    must(room.handle(kp, cmd("object.update", { id: t.id, locked: true })));
    expect(room.handle(seo, cmd("object.move", { id: t.id, x: 0, y: 0, rev: 1 }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(room.handle(kp, cmd("object.move", { id: t.id, x: 0, y: 0, rev: 1 })).ok).toBe(true);
  });

  it("오래된 rev의 이동은 거절하고 요청자에게만 최신 상태를 보낸다", () => {
    const room = setup();
    const t = addToken(room, { ownerId: "pl1" });
    must(room.handle(kp, cmd("object.move", { id: t.id, x: 7, y: 7, rev: 0 })));
    const r = room.handle(seo, cmd("object.move", { id: t.id, x: 9, y: 9, rev: 0 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("stale");
      expect(r.out).toHaveLength(1);
      expect(received(r.out ?? [], seo)).toHaveLength(1);
      expect(received(r.out ?? [], han)).toHaveLength(0);
      expect(r.out?.[0]?.event).toMatchObject({ type: "object.updated", data: { x: 7, y: 7, rev: 1 } });
    }
  });

  it("GM 전용 오브젝트는 GM에게만 보이고 스냅샷에도 없다", () => {
    const room = setup();
    const outs = must(room.handle(kp, cmd("object.add", { kind: "prop", name: "비밀문", x: 0, y: 0, layer: "gm", visibleTo: "all" })));
    expect(received(outs, kp)).toHaveLength(1);
    for (const v of [seo, han, spec]) expect(received(outs, v)).toHaveLength(0);
    expect(room.snapshot(kp).objects).toHaveLength(1);
    expect(room.snapshot(seo).objects).toHaveLength(0);
    expect(room.snapshot(spec).objects).toHaveLength(0);
  });

  it("지정한 사용자에게만 보이는 오브젝트", () => {
    const room = setup();
    const outs = must(room.handle(kp, cmd("object.add", { kind: "prop", name: "쪽지", x: 0, y: 0, layer: "object", visibleTo: ["pl1"] })));
    expect(received(outs, seo)).toHaveLength(1);
    expect(received(outs, han)).toHaveLength(0);
    expect(room.snapshot(han).objects).toHaveLength(0);
  });

  it("공개하면 새로 보이는 사람에게는 added가 간다", () => {
    const room = setup();
    const secret = addToken(room, { layer: "gm", name: "미지의 것" });
    const outs = must(room.handle(kp, cmd("object.update", { id: secret.id, layer: "object" })));
    expect(received(outs, seo)).toEqual([expect.objectContaining({ type: "object.added" })]);
    expect(received(outs, kp)).toEqual([expect.objectContaining({ type: "object.updated" })]);
  });

  it("다시 숨기면 보던 사람에게는 removed가 간다", () => {
    const room = setup();
    const t = addToken(room);
    const outs = must(room.handle(kp, cmd("object.update", { id: t.id, visibleTo: "gm" })));
    expect(received(outs, seo)).toEqual([{ type: "object.removed", data: { id: t.id } }]);
    expect(received(outs, kp)).toEqual([expect.objectContaining({ type: "object.updated" })]);
  });

  it("숨겨진 오브젝트는 PL이 id를 알아도 움직일 수 없다", () => {
    const room = setup();
    const t = addToken(room, { layer: "gm", ownerId: "pl1" });
    expect(room.handle(seo, cmd("object.move", { id: t.id, x: 1, y: 1, rev: 0 }))).toMatchObject({ ok: false, code: "not_found" });
  });

  it("삭제하면 보던 사람에게 removed가 간다", () => {
    const room = setup();
    const t = addToken(room);
    const outs = must(room.handle(kp, cmd("object.remove", { id: t.id })));
    expect(received(outs, seo)).toEqual([{ type: "object.removed", data: { id: t.id } }]);
    expect(room.snapshot(seo).objects).toHaveLength(0);
  });

  it("canSee 규칙", () => {
    const base = { id: "a", sceneId: "main", kind: "prop" as const, name: "a", x: 0, y: 0, locked: false, rev: 0 };
    expect(canSee({ ...base, layer: "object", visibleTo: "gm" }, { userId: "p", role: "pl" })).toBe(false);
    expect(canSee({ ...base, layer: "object", visibleTo: "gm" }, { userId: "k", role: "kp" })).toBe(true);
    expect(canSee({ ...base, layer: "object", visibleTo: "all" }, { userId: "s", role: "spectator" })).toBe(true);
  });
});

describe("굴림", () => {
  const fixed: Rng = () => 0.25; // d10 → 2, d100 → 26

  it("서버가 굴려 모두에게 보낸다", () => {
    const room = setup({ rng: fixed });
    const outs = must(room.handle(seo, cmd("roll.request", { expr: "CC<=60", secret: false })));
    for (const v of [kp, seo, han, spec]) {
      const evs = received(outs, v);
      expect(evs).toHaveLength(1);
      expect(evs[0]).toMatchObject({ type: "roll.result", data: { userName: "윤서하", secret: false } });
    }
    expect(room.snapshot(han).rolls).toHaveLength(1);
  });

  it("GM의 비밀 굴림: GM은 결과를, 나머지는 굴렸다는 사실만 받는다", () => {
    const room = setup({ rng: fixed });
    const outs = must(room.handle(kp, cmd("roll.request", { expr: "CC<=60", secret: true })));
    expect(received(outs, kp)).toEqual([expect.objectContaining({ type: "roll.result" })]);
    for (const v of [seo, han, spec]) {
      const evs = received(outs, v);
      expect(evs).toHaveLength(1);
      expect(evs[0]).toMatchObject({ type: "roll.hidden" });
      expect(JSON.stringify(evs[0])).not.toContain("outcome");
    }
  });

  it("비밀 굴림은 스냅샷에서도 GM에게만 보인다", () => {
    const room = setup({ rng: fixed });
    must(room.handle(kp, cmd("roll.request", { expr: "1d100", secret: true })));
    expect(room.snapshot(kp).rolls).toHaveLength(1);
    expect(room.snapshot(seo).rolls).toHaveLength(0);
  });

  it("PL은 비밀 굴림을 쓸 수 없고 관전자는 굴릴 수 없다", () => {
    const room = setup({ rng: fixed });
    expect(room.handle(seo, cmd("roll.request", { expr: "1d100", secret: true }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(room.handle(spec, cmd("roll.request", { expr: "1d100", secret: false }))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("잘못된 식은 bad_roll", () => {
    const room = setup();
    expect(room.handle(seo, cmd("roll.request", { expr: "ccb<=60", secret: false }))).toMatchObject({ ok: false, code: "bad_roll" });
  });

  it("초당 5번을 넘기면 막고, 1초 뒤에는 다시 허용한다", () => {
    let t = 1_000;
    const room = setup({ rng: fixed, now: () => t });
    for (let i = 0; i < 5; i++) expect(room.handle(seo, cmd("roll.request", { expr: "1d6", secret: false })).ok).toBe(true);
    expect(room.handle(seo, cmd("roll.request", { expr: "1d6", secret: false }))).toMatchObject({ ok: false, code: "rate_limited" });
    expect(room.handle(han, cmd("roll.request", { expr: "1d6", secret: false })).ok).toBe(true); // 사람별로 센다
    t += 1_001;
    expect(room.handle(seo, cmd("roll.request", { expr: "1d6", secret: false })).ok).toBe(true);
  });
});

describe("재접속", () => {
  it("버퍼에 남은 구간만 받고, 자기에게 안 보이던 이벤트는 받지 않는다", () => {
    const room = setup();
    const before = room.currentSeq;
    addToken(room, { layer: "gm", name: "숨김" });
    addToken(room, { name: "보임" });
    const missed = room.eventsSince(seo, before);
    expect(missed).not.toBeNull();
    expect(missed?.map((o) => o.event.type)).toEqual(["object.added"]);
    expect(room.eventsSince(kp, before)?.map((o) => o.event.type)).toEqual(["object.added", "object.added"]);
  });

  it("이미 최신이면 빈 목록", () => {
    const room = setup();
    expect(room.eventsSince(seo, room.currentSeq)).toEqual([]);
  });

  it("버퍼를 넘기면 null이라 스냅샷으로 다시 맞춘다", () => {
    const room = setup({ bufferSize: 3 });
    const before = room.currentSeq;
    for (let i = 0; i < 6; i++) addToken(room, { name: `t${i}` });
    expect(room.eventsSince(seo, before)).toBeNull();
    expect(room.snapshot(seo).objects).toHaveLength(6);
  });

  it("서버보다 앞선 seq(서버 재시작 등)는 null", () => {
    const room = setup();
    expect(room.eventsSince(seo, room.currentSeq + 10)).toBeNull();
  });

  it("같은 사용자가 다시 접속해도 접속 알림을 중복으로 보내지 않는다", () => {
    const room = setup();
    expect(room.join(seo)).toEqual([]);
    room.leave("pl1");
    expect(room.join(seo)).toHaveLength(1);
  });
});

describe("저장과 복원", () => {
  it("저장한 상태에서 같은 룸을 되살린다(접속자는 모두 오프라인)", () => {
    const room = setup({ rng: () => 0.25 });
    addToken(room, { ownerId: "pl1", name: "윤서하" });
    addToken(room, { layer: "gm", name: "비밀" });
    must(room.handle(seo, cmd("roll.request", { expr: "CC<=60", secret: false })));

    const restored = Room.fromData(JSON.parse(JSON.stringify(room.toData())), { newId: () => `r-${++counter}` });
    expect(restored.currentSeq).toBe(room.currentSeq);
    expect(restored.snapshot(kp).objects).toHaveLength(2);
    expect(restored.snapshot(seo).objects).toHaveLength(1);
    expect(restored.snapshot(kp).rolls).toHaveLength(1);
    expect(restored.snapshot(kp).members.every((m) => !m.online)).toBe(true);
    expect(restored.snapshot(kp).sessionNumber).toBe(1);
  });

  it("진행 중이던 세션은 자동 정지로 복원하고, 세션 없음은 그대로 둔다", () => {
    const active = setup();
    const restored = Room.fromData(active.toData());
    expect(restored.sessionStatus).toBe("PAUSED");
    expect(restored.snapshot(kp).pauseReason).toBe("kp_disconnected");
    const idle = newRoom();
    idle.join(kp);
    expect(Room.fromData(idle.toData()).sessionStatus).toBe("IDLE");
  });

  it("복원 뒤에는 버퍼가 비어 있어 이전 seq로 접속하면 snapshot으로 다시 맞춘다", () => {
    const room = setup();
    const lastSeq = room.currentSeq;
    const restored = Room.fromData(room.toData());
    expect(restored.eventsSince(seo, lastSeq - 1)).toBeNull();
    expect(restored.eventsSince(seo, lastSeq)).toEqual([]);
  });

  it("복원한 룸에서 GM이 들어오면 자동으로 재개되어 다시 진행된다", () => {
    const restored = Room.fromData(setup().toData());
    restored.join(seo);
    expect(restored.sessionStatus).toBe("PAUSED");
    restored.join(kp);
    expect(restored.sessionStatus).toBe("ACTIVE");
    expect(restored.handle(seo, cmd("roll.request", { expr: "1d6", secret: false })).ok).toBe(true);
  });
});
