import { describe, expect, it } from "vitest";
import type { ClientCommand } from "@coc-vtt/shared";
import { inAudience, Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const seo: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const han: Actor = { userId: "pl2", name: "한도윤", role: "pl" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) =>
  ({ type, data }) as ClientCommand;

const setup = () => {
  const room = new Room("r", { newId: () => `s-${++n}` });
  for (const a of [kp, seo, han]) room.join(a);
  room.handle(kp, cmd("session.start", {}));
  return room;
};

const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const to = (outs: Out[], a: Actor) => outs.filter((o) => inAudience(o.audience, a)).map((o) => o.event);

const newScene = (room: Room, name = "서재") => {
  const outs = must(room.handle(kp, cmd("scene.create", { name })));
  return (outs[0]!.event as { data: { id: string } }).data.id;
};
const addObj = (room: Room, name: string, sceneId?: string) => {
  const outs = must(room.handle(kp, cmd("object.add", { kind: "prop", name, x: 1, y: 2, layer: "object", visibleTo: "all", ...(sceneId ? { sceneId } : {}) })));
  return (outs.find((o) => o.event.type === "object.added")!.event as { data: { id: string } }).data.id;
};

describe("장면", () => {
  it("처음에는 기본 장면 하나가 활성이다", () => {
    const snap = setup().snapshot(kp);
    expect(snap.activeSceneId).toBe("main");
    expect(snap.scenes.map((s) => s.name)).toEqual(["장면 1"]);
  });

  it("새 장면은 KP에게만 알려지고, PL의 snapshot에는 활성 장면만 담긴다", () => {
    const room = setup();
    const outs = must(room.handle(kp, cmd("scene.create", { name: "비밀 지하실" })));
    expect(to(outs, seo)).toEqual([]);
    expect(room.snapshot(kp).scenes).toHaveLength(2);
    expect(room.snapshot(seo).scenes.map((s) => s.name)).toEqual(["장면 1"]);
  });

  it("다른 장면에 놓은 오브젝트는 PL에게 보이지 않고, KP에게는 보인다", () => {
    const room = setup();
    const sc = newScene(room);
    const outs = must(room.handle(kp, cmd("object.add", { kind: "prop", name: "책장", x: 0, y: 0, layer: "object", visibleTo: "all", sceneId: sc })));
    expect(to(outs, seo)).toEqual([]);
    expect(to(outs, kp)).toHaveLength(1);
    expect(room.snapshot(seo).objects).toEqual([]);
    expect(room.snapshot(kp).objects).toHaveLength(1);
  });

  it("장면을 활성화하면 PL은 새 장면의 오브젝트로 통째로 바뀌고 전환 효과를 받는다", () => {
    const room = setup();
    addObj(room, "현관 문");
    const sc = newScene(room);
    addObj(room, "책장", sc);
    const outs = must(room.handle(kp, cmd("scene.activate", { id: sc, transition: "fade" })));
    const pl = to(outs, seo)[0] as { type: string; data: { transition: string; scene: { name: string }; objects?: Array<{ name: string }> } };
    expect(pl.type).toBe("scene.activated");
    expect(pl.data.transition).toBe("fade");
    expect(pl.data.objects?.map((o) => o.name)).toEqual(["책장"]);
    const k = to(outs, kp)[0] as { data: { objects?: unknown } };
    expect(k.data.objects).toBeUndefined();
    expect(room.snapshot(seo).objects.map((o) => o.name)).toEqual(["책장"]);
    expect(room.snapshot(seo).activeSceneId).toBe(sc);
  });

  it("전환 알림은 모든 접속자에게 사람마다 한 번씩 간다", () => {
    const room = setup();
    const sc = newScene(room);
    const outs = must(room.handle(kp, cmd("scene.activate", { id: sc, transition: "cut" })));
    for (const a of [kp, seo, han]) expect(to(outs, a)).toHaveLength(1);
  });

  it("KP는 활성이 아닌 장면의 오브젝트를 준비하고 움직여도 PL에게는 아무 일도 없다", () => {
    const room = setup();
    const sc = newScene(room);
    const id = addObj(room, "책장", sc);
    const outs = must(room.handle(kp, cmd("object.move", { id, x: 50, y: 60, rev: 0 })));
    expect(to(outs, seo)).toEqual([]);
    expect(room.snapshot(kp).objects.find((o) => o.id === id)).toMatchObject({ x: 50, y: 60 });
  });

  it("PL은 활성이 아닌 장면의 오브젝트를 움직일 수 없다", () => {
    const room = setup();
    const sc = newScene(room);
    const outOut = must(room.handle(kp, cmd("object.add", { kind: "token", name: "서하", x: 0, y: 0, layer: "object", visibleTo: "all", ownerId: "pl1", sceneId: sc })));
    const id = (outOut.find((o) => o.event.type === "object.added")!.event as { data: { id: string } }).data.id;
    expect(room.handle(seo, cmd("object.move", { id, x: 1, y: 1, rev: 0 }))).toMatchObject({ ok: false, code: "not_found" });
  });

  it("활성 장면과 없는 장면은 지울 수 없고, 지우면 안의 오브젝트도 사라진다", () => {
    const room = setup();
    expect(room.handle(kp, cmd("scene.remove", { id: "main" }))).toMatchObject({ ok: false, code: "bad_message" });
    expect(room.handle(kp, cmd("scene.remove", { id: "nope" }))).toMatchObject({ ok: false, code: "not_found" });
    const sc = newScene(room);
    addObj(room, "책장", sc);
    must(room.handle(kp, cmd("scene.remove", { id: sc })));
    expect(room.snapshot(kp).objects).toEqual([]);
    expect(room.snapshot(kp).scenes).toHaveLength(1);
  });

  it("이미 활성인 장면은 다시 활성화할 수 없다", () => {
    expect(setup().handle(kp, cmd("scene.activate", { id: "main", transition: "cut" }))).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("활성 장면 이름을 바꾸면 모두에게, 다른 장면이면 KP에게만 알린다", () => {
    const room = setup();
    const sc = newScene(room);
    expect(to(must(room.handle(kp, cmd("scene.rename", { id: "main", name: "현관" }))), seo)).toHaveLength(1);
    expect(to(must(room.handle(kp, cmd("scene.rename", { id: sc, name: "다락방" }))), seo)).toEqual([]);
  });

  it("KP가 아니면 장면을 다룰 수 없다", () => {
    const room = setup();
    const sc = newScene(room);
    for (const c of [cmd("scene.create", { name: "x" }), cmd("scene.rename", { id: sc, name: "x" }), cmd("scene.remove", { id: sc }), cmd("scene.activate", { id: sc, transition: "cut" })]) {
      expect(room.handle(seo, c)).toMatchObject({ ok: false, code: "forbidden" });
    }
  });

  it("저장하고 복원해도 장면과 활성 장면이 유지되고, 장면이 없던 옛 데이터는 기본 장면으로 읽는다", () => {
    const room = setup();
    const sc = newScene(room);
    addObj(room, "책장", sc);
    must(room.handle(kp, cmd("scene.activate", { id: sc, transition: "cut" })));
    const restored = Room.fromData(room.toData());
    expect(restored.snapshot(kp).activeSceneId).toBe(sc);
    expect(restored.snapshot(seo).objects.map((o) => o.name)).toEqual(["책장"]);

    const old = { ...room.toData(), scenes: undefined, activeSceneId: undefined, objects: [{ id: "o", kind: "prop", name: "옛 소품", x: 0, y: 0, layer: "object", visibleTo: "all", locked: false, rev: 0 }] } as never;
    const migrated = Room.fromData(old);
    expect(migrated.snapshot(seo).activeSceneId).toBe("main");
    expect(migrated.snapshot(seo).objects.map((o) => o.name)).toEqual(["옛 소품"]);
  });
});
