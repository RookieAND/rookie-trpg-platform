import { describe, expect, it } from "vitest";
import type { ClientCommand, GameObject } from "@coc-vtt/shared";
import { Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl1: Actor = { userId: "pl1", name: "서하", role: "pl" };
const pl2: Actor = { userId: "pl2", name: "도윤", role: "pl" };
const spec: Actor = { userId: "sp1", name: "관전", role: "spectator" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const evOf = (out: Out[], type: string) => out.filter((o) => o.event.type === type);
const toUser = (out: Out[], type: string, user: string) => evOf(out, type).filter((o) => o.audience.users?.includes(user));

const setup = () => {
  const room = new Room("r", { newId: () => `id-${++n}`, rng: () => 0.5 });
  for (const a of [kp, pl1, pl2, spec]) room.join(a);
  must(room.handle(kp, cmd("session.start", {})));
  const add = (name: string, extra: Partial<Extract<ClientCommand, { type: "object.add" }>["data"]> = {}): GameObject => {
    const out = must(room.handle(kp, cmd("object.add", { kind: "token", name, x: 500, y: 400, layer: "object", visibleTo: "all", ...extra })));
    return (evOf(out, "object.added")[0]!.event as { data: GameObject }).data;
  };
  return { room, add };
};

describe("토큰 소유자·이름·빈자리", () => {
  it("autoPlace는 겹치지 않는 가장 가까운 자리에 놓는다", () => {
    const { add } = setup();
    const a = add("a", { autoPlace: true });
    expect([a.x, a.y]).toEqual([500, 400]);
    const spots = [a, ...Array.from({ length: 8 }, (_, i) => add(`t${i}`, { autoPlace: true }))];
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.y - spots[j]!.y)).toBeGreaterThanOrEqual(56);
      }
    }
    expect(Math.max(...spots.map((s) => Math.hypot(s.x - 500, s.y - 400)))).toBeLessThanOrEqual(56 * 2);
  });

  it("autoPlace가 없으면 좌표를 그대로 쓴다", () => {
    const { add } = setup();
    add("a");
    const b = add("b");
    expect([b.x, b.y]).toEqual([500, 400]);
  });

  it("KP만 소유자를 바꾸고, 룸의 PL만 소유자가 될 수 있다", () => {
    const { room, add } = setup();
    const t = add("토큰", { ownerId: "pl1" });
    expect(room.handle(pl1, cmd("object.update", { id: t.id, ownerId: "pl2" })).ok).toBe(false);
    expect(room.handle(pl1, cmd("object.update", { id: t.id, name: "내꺼" })).ok).toBe(false);
    expect(room.handle(kp, cmd("object.update", { id: t.id, ownerId: "sp1" })).ok).toBe(false);
    expect(room.handle(kp, cmd("object.update", { id: t.id, ownerId: "kp1" })).ok).toBe(false);
    expect(room.handle(kp, cmd("object.update", { id: t.id, ownerId: "nobody" })).ok).toBe(false);
    expect(room.handle(kp, cmd("object.add", { kind: "token", name: "x", x: 1, y: 1, layer: "object", visibleTo: "all", ownerId: "sp1" })).ok).toBe(false);
  });

  it("소유자를 바꾸면 움직일 수 있는 사람이 바뀐다", () => {
    const { room, add } = setup();
    const t = add("토큰", { ownerId: "pl1" });
    must(room.handle(pl1, cmd("object.move", { id: t.id, x: 10, y: 10, rev: 0 })));
    must(room.handle(kp, cmd("object.update", { id: t.id, ownerId: "pl2", name: "도윤 토큰" })));
    const cur = room.snapshot(pl2).objects.find((o) => o.id === t.id)!;
    expect(cur.name).toBe("도윤 토큰");
    expect(room.handle(pl1, cmd("object.move", { id: t.id, x: 20, y: 20, rev: cur.rev })).ok).toBe(false);
    expect(room.handle(pl2, cmd("object.move", { id: t.id, x: 20, y: 20, rev: cur.rev })).ok).toBe(true);
  });

  it("null이면 소유자를 푼다(NPC): PL은 움직일 수 없다", () => {
    const { room, add } = setup();
    const t = add("토큰", { ownerId: "pl1" });
    must(room.handle(kp, cmd("object.update", { id: t.id, ownerId: null })));
    const cur = room.snapshot(kp).objects.find((o) => o.id === t.id)!;
    expect(cur.ownerId).toBeUndefined();
    expect(room.handle(pl1, cmd("object.move", { id: t.id, x: 1, y: 1, rev: cur.rev })).ok).toBe(false);
  });

  it("안개에서: 소유자를 주면 주인과 파티원에게 보이고, 풀면 시야 밖에서 다시 사라진다", () => {
    const { room, add } = setup();
    must(room.handle(kp, cmd("scene.fog", { id: "main", enabled: true })));
    const t = add("멀리", { x: 900, y: 700 });
    expect(room.snapshot(pl1).objects.map((o) => o.id)).not.toContain(t.id);
    expect(room.snapshot(pl2).objects.map((o) => o.id)).not.toContain(t.id);
    const given = must(room.handle(kp, cmd("object.update", { id: t.id, ownerId: "pl1" })));
    expect(toUser(given, "object.added", "pl1")).toHaveLength(1);
    expect(toUser(given, "object.added", "pl2")).toHaveLength(1);
    expect(room.snapshot(pl2).objects.map((o) => o.id)).toContain(t.id);
    const freed = must(room.handle(kp, cmd("object.update", { id: t.id, ownerId: null })));
    expect(toUser(freed, "object.removed", "pl1")).toHaveLength(1);
    expect(toUser(freed, "object.removed", "pl2")).toHaveLength(1);
    expect(room.snapshot(pl1).objects.map((o) => o.id)).not.toContain(t.id);
  });

  it("이름을 바꾸면 보이는 사람에게 갱신이 간다", () => {
    const { room, add } = setup();
    const t = add("토큰");
    const out = must(room.handle(kp, cmd("object.update", { id: t.id, name: "새 이름" })));
    expect(toUser(out, "object.updated", "pl1")).toHaveLength(1);
  });
});

describe("장면 전환에 PL 토큰이 따라옴", () => {
  const twoScenes = () => {
    const { room, add } = setup();
    const out = must(room.handle(kp, cmd("scene.create", { name: "지하실" })));
    const sceneId = (out[0]!.event as { data: { id: string } }).data.id;
    return { room, add, sceneId };
  };

  it("새 장면에 토큰이 없는 PL에게는 이름·소유자를 이어받은 토큰이 빈자리에 생긴다", () => {
    const { room, add, sceneId } = twoScenes();
    add("서하", { ownerId: "pl1" });
    const out = must(room.handle(kp, cmd("scene.activate", { id: sceneId, transition: "cut" })));
    const mine = room.snapshot(pl1).objects.filter((o) => o.kind === "token" && o.ownerId === "pl1");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.sceneId).toBe(sceneId);
    expect(mine[0]!.name).toBe("서하");
    // PL은 장면 목록으로 받고 KP는 object.added로 받는다
    expect(toUser(out, "object.added", "kp1")).toHaveLength(1);
    expect(toUser(out, "object.added", "pl1")).toHaveLength(0);
  });

  it("이미 토큰이 있는 PL은 복사하지 않고, bringParty=false면 아무도 복사하지 않는다", () => {
    const a = twoScenes();
    a.add("서하", { ownerId: "pl1" });
    a.add("서하(지하실)", { ownerId: "pl1", sceneId: a.sceneId });
    must(a.room.handle(kp, cmd("scene.activate", { id: a.sceneId, transition: "cut" })));
    expect(a.room.snapshot(pl1).objects.filter((o) => o.ownerId === "pl1")).toHaveLength(1);

    const b = twoScenes();
    b.add("서하", { ownerId: "pl1" });
    must(b.room.handle(kp, cmd("scene.activate", { id: b.sceneId, transition: "cut", bringParty: false })));
    expect(b.room.snapshot(pl1).objects.filter((o) => o.ownerId === "pl1")).toHaveLength(0);
  });
});
