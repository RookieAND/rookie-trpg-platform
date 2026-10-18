import { describe, expect, it } from "vitest";
import type { ClientCommand } from "@coc-vtt/shared";
import { Room, type Actor, type Out } from "./room";
import { pingRecipients, pointVisible } from "./ping";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const pl2: Actor = { userId: "pl2", name: "한도윤", role: "pl" };
const spec: Actor = { userId: "sp1", name: "관전", role: "spectator" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const ping = (out: Out[]) => out.filter((o) => o.event.type === "board.pinged");
const ping_to = (out: Out[], user: string) => ping(out).some((o) => o.audience.users?.includes(user));

const setup = () => {
  let t = 1000;
  const clock = { advance: (ms: number) => (t += ms) };
  const room = new Room("r", { newId: () => `id-${++n}`, rng: () => 0.5, now: () => t });
  for (const a of [kp, pl, pl2, spec]) room.join(a);
  must(room.handle(kp, cmd("session.start", {})));
  return { room, clock };
};

describe("board.ping", () => {
  it("PL과 GM은 가리킬 수 있고 모두에게 전달된다(저장·버퍼에는 남지 않는다)", () => {
    const { room } = setup();
    const out = must(room.handle(pl, cmd("board.ping", { sceneId: "main", x: 300, y: 200 })));
    expect(ping(out)).toHaveLength(1);
    const ev = ping(out)[0]!.event as Extract<Out["event"], { type: "board.pinged" }>;
    expect(ev.data).toMatchObject({ userId: "pl1", userName: "윤서하", x: 300, y: 200, sceneId: "main", at: 1000 });
    for (const u of ["kp1", "pl1", "pl2", "sp1"]) expect(ping_to(out, u)).toBe(true);
    // 버퍼(다시 접속한 사람에게 보내는 기록)에 남지 않는다.
    expect(room.eventsSince(kp, 0)?.some((o) => o.event.type === "board.pinged") ?? false).toBe(false);
    expect(ping_to(must(room.handle(kp, cmd("board.ping", { sceneId: "main", x: 10, y: 20 }))), "pl2")).toBe(true);
  });

  it("스펙테이터는 가리킬 수 없다", () => {
    const { room } = setup();
    const r = room.handle(spec, cmd("board.ping", { sceneId: "main", x: 1, y: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("forbidden");
  });

  it("세션이 시작되기 전에는 PL이 못 하고, 일시정지 중에도 PL은 못 한다", () => {
    const room = new Room("r", { newId: () => `id-${++n}` });
    for (const a of [kp, pl]) room.join(a);
    const r = room.handle(pl, cmd("board.ping", { sceneId: "main", x: 1, y: 1 }));
    expect(!r.ok && r.code).toBe("idle");
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(kp, cmd("session.pause", {})));
    const p = room.handle(pl, cmd("board.ping", { sceneId: "main", x: 1, y: 1 }));
    expect(!p.ok && p.code).toBe("paused");
  });

  it("활성 장면이 아닌 장면의 핑은 거절한다", () => {
    const { room } = setup();
    must(room.handle(kp, cmd("scene.create", { name: "서재" })));
    const sceneId = room.snapshot(kp).scenes.find((s) => s.name === "서재")!.id;
    const r = room.handle(kp, cmd("board.ping", { sceneId, x: 5, y: 5 }));
    expect(!r.ok && r.code).toBe("bad_message");
    const stale = room.handle(pl, cmd("board.ping", { sceneId: "없는장면", x: 5, y: 5 }));
    expect(stale.ok).toBe(false);
  });

  it("사용자당 초당 2회까지, 1초가 지나면 다시 가능하고 사용자끼리는 따로 센다", () => {
    const { room, clock } = setup();
    const p = (a: Actor) => room.handle(a, cmd("board.ping", { sceneId: "main", x: 1, y: 1 }));
    expect(p(pl).ok).toBe(true);
    expect(p(pl).ok).toBe(true);
    const third = p(pl);
    expect(!third.ok && third.code).toBe("rate_limited");
    expect(p(pl2).ok).toBe(true);
    clock.advance(1001);
    expect(p(pl).ok).toBe(true);
  });

  it("안개가 있으면 안개 속 좌표의 핑은 다른 PL에게 가지 않고 GM과 핑한 사람에게만 간다", () => {
    const { room } = setup();
    must(room.handle(kp, cmd("scene.fog", { id: "main", enabled: true })));
    must(room.handle(kp, cmd("fog.reveal", { sceneId: "main", x: 200, y: 200, r: 100 })));
    const hidden = must(room.handle(pl, cmd("board.ping", { sceneId: "main", x: 800, y: 600 })));
    expect(ping_to(hidden, "kp1")).toBe(true);
    expect(ping_to(hidden, "pl1")).toBe(true);
    expect(ping_to(hidden, "pl2")).toBe(false);
    expect(ping_to(hidden, "sp1")).toBe(false);
    // 보이는 원 안이면 모두에게 간다.
    const seen = must(room.handle(pl, cmd("board.ping", { sceneId: "main", x: 230, y: 210 })));
    for (const u of ["kp1", "pl1", "pl2", "sp1"]) expect(ping_to(seen, u)).toBe(true);
    // GM은 안개 속에 찍어도 다른 사람에게 새지 않는다.
    expect(ping_to(must(room.handle(kp, cmd("board.ping", { sceneId: "main", x: 900, y: 700 }))), "pl2")).toBe(false);
  });

  it("범위 밖 좌표는 보드 안으로 맞춘다", () => {
    const { room } = setup();
    const ev = ping(must(room.handle(pl, cmd("board.ping", { sceneId: "main", x: -50, y: 5000 }))))[0]!.event as Extract<Out["event"], { type: "board.pinged" }>;
    expect(ev.data).toMatchObject({ x: 0, y: 800 });
  });
});

describe("pingRecipients", () => {
  const members = [kp, pl, pl2];
  it("안개가 없으면 모두", () => {
    expect(pingRecipients(members, undefined, 5, 5, "pl1").sort()).toEqual(["kp1", "pl1", "pl2"]);
  });
  it("원 경계는 보이는 곳으로 친다", () => {
    expect(pointVisible([{ x: 0, y: 0, r: 100 }], 100, 0)).toBe(true);
    expect(pointVisible([{ x: 0, y: 0, r: 100 }], 101, 0)).toBe(false);
    expect(pointVisible([], 0, 0)).toBe(false);
  });
});
