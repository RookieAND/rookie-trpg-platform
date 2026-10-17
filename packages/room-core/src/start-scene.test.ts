import { describe, expect, it } from "vitest";
import type { ClientCommand } from "@coc-vtt/shared";
import { Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl: Actor = { userId: "pl1", name: "윤서하", role: "pl" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const setup = () => {
  const room = new Room("r", { newId: () => `id-${++n}`, rng: () => 0.5 });
  room.join(kp);
  room.join(pl);
  const ev = must(room.handle(kp, cmd("scene.create", { name: "현관 홀" })))[0]!.event;
  if (ev.type !== "scene.added") throw new Error();
  return { room, hall: ev.data.id };
};

describe("시작 장면", () => {
  it("KP만 정하고, 지정은 하나만 남는다", () => {
    const { room, hall } = setup();
    expect(room.handle(pl, cmd("scene.setStart", { id: hall })).ok).toBe(false);
    must(room.handle(kp, cmd("scene.setStart", { id: "main" })));
    must(room.handle(kp, cmd("scene.setStart", { id: hall })));
    const starts = room.snapshot(kp).scenes.filter((s) => s.start).map((s) => s.id);
    expect(starts).toEqual([hall]);
    must(room.handle(kp, cmd("scene.setStart", { id: null })));
    expect(room.snapshot(kp).scenes.some((s) => s.start)).toBe(false);
    expect(room.handle(kp, cmd("scene.setStart", { id: "nope" })).ok).toBe(false);
  });

  it("세션을 시작하면 시작 장면이 열리고 PL은 지정 표시를 모른다", () => {
    const { room, hall } = setup();
    must(room.handle(kp, cmd("scene.setStart", { id: hall })));
    const out = must(room.handle(kp, cmd("session.start", {})));
    expect(out.map((o) => o.event.type)).toEqual(["session.started", "scene.activated", "scene.activated"]);
    for (const o of out) {
      if (o.event.type === "scene.activated") expect(o.event.data.scene.id).toBe(hall);
    }
    const plScene = out.find((o) => o.event.type === "scene.activated" && o.audience.users?.includes("pl1"))!.event;
    if (plScene.type !== "scene.activated") throw new Error();
    expect(plScene.data.scene.start).toBeUndefined();
    expect(room.snapshot(pl).scenes).toEqual([{ id: hall, name: "현관 홀" }]);
  });

  it("지정이 없거나 이미 그 장면이면 장면은 그대로", () => {
    const { room } = setup();
    expect(must(room.handle(kp, cmd("session.start", {}))).map((o) => o.event.type)).toEqual(["session.started"]);
    const again = setup();
    must(again.room.handle(kp, cmd("scene.setStart", { id: "main" })));
    expect(must(again.room.handle(kp, cmd("session.start", {}))).map((o) => o.event.type)).toEqual(["session.started"]);
  });

  it("지정은 저장했다 복원해도 남는다", () => {
    const { room, hall } = setup();
    must(room.handle(kp, cmd("scene.setStart", { id: hall })));
    const back = Room.fromData(room.toData(), { newId: () => `id-${++n}`, rng: () => 0.5 });
    expect(back.snapshot(kp).scenes.find((s) => s.id === hall)!.start).toBe(true);
  });

  it("활성 장면의 이름이 바뀌어도 PL에게 지정 표시가 새지 않는다", () => {
    const { room } = setup();
    must(room.handle(kp, cmd("scene.setStart", { id: "main" })));
    const out = must(room.handle(kp, cmd("scene.rename", { id: "main", name: "새 이름" })));
    const forPl = out.find((o) => o.audience.roles?.includes("pl"))!.event;
    if (forPl.type !== "scene.updated") throw new Error();
    expect(forPl.data.start).toBeUndefined();
    const forKp = out.find((o) => o.audience.roles?.includes("kp"))!.event;
    if (forKp.type !== "scene.updated") throw new Error();
    expect(forKp.data.start).toBe(true);
  });
});
