import { describe, expect, it } from "vitest";
import { MAX_FOG_ZONES, type ClientCommand, type GameObject } from "@coc-vtt/shared";
import { Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const spec: Actor = { userId: "sp1", name: "관전", role: "spectator" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const added = (out: Out[]) => out.find((o) => o.event.type === "object.added")?.event as Extract<Out["event"], { type: "object.added" }> | undefined;

const setup = () => {
  const room = new Room("r", { newId: () => `id-${++n}`, rng: () => 0.5 });
  room.join(kp);
  room.join(pl);
  room.join(spec);
  must(room.handle(kp, cmd("session.start", {})));
  const obj = (name: string, x: number, y: number, extra: Partial<Extract<ClientCommand, { type: "object.add" }>["data"]> = {}): GameObject => {
    const ev = added(must(room.handle(kp, cmd("object.add", { kind: "token", name, x, y, layer: "object", visibleTo: "all", ...extra }))))!;
    return ev.data;
  };
  return { room, obj };
};
const names = (room: Room, who: Actor) => room.snapshot(who).objects.map((o) => o.name).sort();
const toUser = (out: Out[], type: string, user: string) => out.filter((o) => o.event.type === type && (o.audience.users?.includes(user) || false));

describe("안개", () => {
  it("KP만 다루고, 꺼져 있으면 아무것도 가리지 않는다", () => {
    const { room, obj } = setup();
    obj("멀리", 900, 700);
    expect(room.handle(pl, cmd("scene.fog", { id: "main", enabled: true })).ok).toBe(false);
    expect(room.handle(pl, cmd("fog.reveal", { sceneId: "main", x: 0, y: 0, r: 100 })).ok).toBe(false);
    expect(room.handle(kp, cmd("scene.fog", { id: "nope", enabled: true })).ok).toBe(false);
    must(room.handle(kp, cmd("fog.reveal", { sceneId: "main", x: 0, y: 0, r: 100 })));
    expect(names(room, pl)).toEqual(["멀리"]);
  });

  it("켜면 원 밖 오브젝트가 PL·관전자에게서 사라지고(KP는 그대로), 원을 지우면 다시 사라진다", () => {
    const { room, obj } = setup();
    obj("가까이", 100, 100);
    obj("멀리", 900, 700);
    const on = must(room.handle(kp, cmd("scene.fog", { id: "main", enabled: true })));
    expect(toUser(on, "object.removed", "pl1")).toHaveLength(2);
    expect(toUser(on, "object.removed", "sp1")).toHaveLength(2);
    expect(toUser(on, "object.removed", "kp1")).toHaveLength(0);
    expect(names(room, pl)).toEqual([]);
    expect(names(room, spec)).toEqual([]);
    expect(names(room, kp)).toEqual(["가까이", "멀리"]);

    const reveal = must(room.handle(kp, cmd("fog.reveal", { sceneId: "main", x: 100, y: 100, r: 50 })));
    expect(toUser(reveal, "object.added", "pl1").map((o) => (o.event as { data: GameObject }).data.name)).toEqual(["가까이"]);
    expect(names(room, pl)).toEqual(["가까이"]);

    const zone = room.snapshot(kp).scenes.find((s) => s.id === "main")!.fog!.zones[0]!;
    const gone = must(room.handle(kp, cmd("fog.remove", { sceneId: "main", zoneId: zone.id })));
    expect(toUser(gone, "object.removed", "pl1")).toHaveLength(1);
    expect(names(room, pl)).toEqual([]);
    expect(room.handle(kp, cmd("fog.remove", { sceneId: "main", zoneId: zone.id })).ok).toBe(false);
  });

  it("내 토큰은 안개 속에서도 보이고, GM 전용 오브젝트는 원 안에서도 안 보인다", () => {
    const { room, obj } = setup();
    obj("내 토큰", 900, 700, { ownerId: "pl1" });
    obj("비밀", 100, 100, { visibleTo: "gm" });
    obj("보통", 100, 100);
    must(room.handle(kp, cmd("scene.fog", { id: "main", enabled: true })));
    must(room.handle(kp, cmd("fog.reveal", { sceneId: "main", x: 100, y: 100, r: 60 })));
    expect(names(room, pl)).toEqual(["내 토큰", "보통"]);
  });

  it("시야가 있는 토큰이 움직이면 닿는 오브젝트가 새로 보이고 벗어나면 사라지며, 원도 알려 준다", () => {
    const { room, obj } = setup();
    const me = obj("내 토큰", 100, 100, { ownerId: "pl1" });
    obj("문", 500, 100);
    must(room.handle(kp, cmd("scene.fog", { id: "main", enabled: true })));
    must(room.handle(kp, cmd("object.update", { id: me.id, vision: 80 })));
    expect(names(room, pl)).toEqual(["내 토큰"]);

    const near = must(room.handle(pl, cmd("object.move", { id: me.id, x: 450, y: 100, rev: room.snapshot(pl).objects[0]!.rev })));
    expect(toUser(near, "object.added", "pl1").map((o) => (o.event as { data: GameObject }).data.name)).toEqual(["문"]);
    const area = near.find((o) => o.event.type === "scene.updated" && o.audience.roles?.includes("pl"))!.event as Extract<Out["event"], { type: "scene.updated" }>;
    expect(area.data.fogAreas).toEqual([{ x: 450, y: 100, r: 80 }]);
    expect(names(room, pl)).toEqual(["내 토큰", "문"]);

    const rev = room.snapshot(pl).objects.find((o) => o.name === "내 토큰")!.rev;
    const away = must(room.handle(pl, cmd("object.move", { id: me.id, x: 100, y: 700, rev })));
    expect(toUser(away, "object.removed", "pl1")).toHaveLength(1);
    expect(names(room, pl)).toEqual(["내 토큰"]);
    // 시야를 없애면 원도 없어진다
    must(room.handle(kp, cmd("object.update", { id: me.id, vision: 0 })));
    expect(room.snapshot(pl).scenes[0]!.fogAreas).toEqual([]);
  });

  it("PL이 받는 장면에는 안개 설정 대신 지금 보이는 원만 있고, KP는 설정 전체를 받는다", () => {
    const { room } = setup();
    must(room.handle(kp, cmd("scene.fog", { id: "main", enabled: true })));
    must(room.handle(kp, cmd("fog.reveal", { sceneId: "main", x: 10, y: 20, r: 30 })));
    const pubScene = room.snapshot(pl).scenes[0]!;
    expect(pubScene.fog).toBeUndefined();
    expect(pubScene.fogAreas).toEqual([{ x: 10, y: 20, r: 30 }]);
    const kpScene = room.snapshot(kp).scenes.find((s) => s.id === "main")!;
    expect(kpScene.fog).toMatchObject({ enabled: true, zones: [{ x: 10, y: 20, r: 30 }] });
    expect(kpScene.fogAreas).toBeUndefined();
    // 끄면 PL에게 원 정보가 없다
    must(room.handle(kp, cmd("scene.fog", { id: "main", enabled: false })));
    expect(room.snapshot(pl).scenes[0]!.fogAreas).toBeUndefined();
  });

  it("장면을 바꿔 들어가면 그 장면의 안개 기준으로 오브젝트를 보낸다", () => {
    const { room, obj } = setup();
    const sc = must(room.handle(kp, cmd("scene.create", { name: "숲" })))[0]!.event;
    if (sc.type !== "scene.added") throw new Error();
    obj("나무", 300, 300, { sceneId: sc.data.id });
    obj("바위", 600, 300, { sceneId: sc.data.id });
    must(room.handle(kp, cmd("scene.fog", { id: sc.data.id, enabled: true })));
    must(room.handle(kp, cmd("fog.reveal", { sceneId: sc.data.id, x: 300, y: 300, r: 50 })));
    const out = must(room.handle(kp, cmd("scene.activate", { id: sc.data.id, transition: "cut" })));
    const act = toUser(out, "scene.activated", "pl1")[0]!.event as Extract<Out["event"], { type: "scene.activated" }>;
    expect(act.data.objects?.map((o) => o.name)).toEqual(["나무"]);
    expect(act.data.scene.fogAreas).toEqual([{ x: 300, y: 300, r: 50 }]);
    expect(act.data.scene.fog).toBeUndefined();
  });

  it("전부 지우기와 한도", () => {
    const { room } = setup();
    expect(room.handle(kp, cmd("fog.clear", { sceneId: "main" })).ok).toBe(false);
    for (let i = 0; i < MAX_FOG_ZONES; i++) must(room.handle(kp, cmd("fog.reveal", { sceneId: "main", x: i, y: 0, r: 10 })));
    expect(room.handle(kp, cmd("fog.reveal", { sceneId: "main", x: 1, y: 1, r: 10 })).ok).toBe(false);
    must(room.handle(kp, cmd("fog.clear", { sceneId: "main" })));
    expect(room.snapshot(kp).scenes.find((s) => s.id === "main")!.fog!.zones).toEqual([]);
  });

  it("저장했다 복원해도 안개와 시야가 남는다", () => {
    const { room, obj } = setup();
    const me = obj("내 토큰", 100, 100, { ownerId: "pl1" });
    must(room.handle(kp, cmd("scene.fog", { id: "main", enabled: true })));
    must(room.handle(kp, cmd("fog.reveal", { sceneId: "main", x: 700, y: 700, r: 40 })));
    must(room.handle(kp, cmd("object.update", { id: me.id, vision: 70 })));
    const back = Room.fromData(JSON.parse(JSON.stringify(room.toData())), { newId: () => `id-${++n}`, rng: () => 0.5 });
    back.join(pl);
    expect(back.snapshot(pl).scenes[0]!.fogAreas).toEqual([{ x: 700, y: 700, r: 40 }, { x: 100, y: 100, r: 70 }]);
  });
});
