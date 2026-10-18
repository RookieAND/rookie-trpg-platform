import { describe, expect, it } from "vitest";
import type { ClientCommand } from "@coc-vtt/shared";
import { Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const IMG = "a".repeat(32);
const IMG2 = "b".repeat(32);

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
  return room;
};

describe("이미지 연결", () => {
  it("토큰에 이미지를 붙이고 떼고, PL은 못 바꾼다", () => {
    const room = setup();
    const ev = must(room.handle(kp, cmd("object.add", { kind: "token", name: "괴물", x: 1, y: 1, layer: "object", visibleTo: "all", image: IMG })))[0]!.event;
    if (ev.type !== "object.added") throw new Error();
    expect(ev.data.image).toBe(IMG);
    must(room.handle(kp, cmd("object.update", { id: ev.data.id, image: IMG2 })));
    expect(room.snapshot(pl).objects[0]!.image).toBe(IMG2);
    must(room.handle(kp, cmd("object.update", { id: ev.data.id, image: null })));
    expect(room.snapshot(pl).objects[0]!.image).toBeUndefined();
    expect(room.handle(pl, cmd("object.update", { id: ev.data.id, image: IMG })).ok).toBe(false);
  });

  it("장면 배경은 GM만 바꾸고, 활성 장면이면 PL에게도 알린다", () => {
    const room = setup();
    expect(room.handle(pl, cmd("scene.background", { id: "main", image: IMG })).ok).toBe(false);
    const out = must(room.handle(kp, cmd("scene.background", { id: "main", image: IMG })));
    expect(out.some((o) => o.audience.roles?.includes("pl"))).toBe(true);
    expect(room.snapshot(pl).scenes[0]!.background).toBe(IMG);
    must(room.handle(kp, cmd("scene.background", { id: "main", image: null })));
    expect(room.snapshot(pl).scenes[0]!.background).toBeUndefined();
    expect(room.handle(kp, cmd("scene.background", { id: "nope", image: IMG })).ok).toBe(false);
  });

  it("비활성 장면의 배경은 GM에게만 알린다", () => {
    const room = setup();
    const ev = must(room.handle(kp, cmd("scene.create", { name: "서재" })))[0]!.event;
    if (ev.type !== "scene.added") throw new Error();
    const out = must(room.handle(kp, cmd("scene.background", { id: ev.data.id, image: IMG })));
    expect(out[0]!.audience.roles).toEqual(["kp"]);
  });

  it("핸드아웃 이미지는 공개 범위를 따라간다", () => {
    const room = setup();
    const ev = must(room.handle(kp, cmd("handout.create", { title: "사진", body: "", visibleTo: "gm", image: IMG })))[0]!.event;
    if (ev.type !== "handout.added") throw new Error();
    expect(room.snapshot(pl).handouts).toHaveLength(0);
    must(room.handle(kp, cmd("handout.update", { id: ev.data.id, visibleTo: "all" })));
    expect(room.snapshot(pl).handouts[0]!.image).toBe(IMG);
    must(room.handle(kp, cmd("handout.update", { id: ev.data.id, image: null })));
    expect(room.snapshot(pl).handouts[0]!.image).toBeUndefined();
  });

  it("저장했다 복원해도 이미지가 남는다", () => {
    const room = setup();
    must(room.handle(kp, cmd("scene.background", { id: "main", image: IMG })));
    must(room.handle(kp, cmd("object.add", { kind: "prop", name: "문", x: 0, y: 0, layer: "object", visibleTo: "all", image: IMG2 })));
    const back = Room.fromData(room.toData(), { newId: () => `id-${++n}`, rng: () => 0.5 });
    back.join(kp);
    const snap = back.snapshot(kp);
    expect(snap.scenes[0]!.background).toBe(IMG);
    expect(snap.objects[0]!.image).toBe(IMG2);
  });

  it("잘못된 이미지 id는 프로토콜이 거절한다", async () => {
    const { clientCommandSchema } = await import("@coc-vtt/shared");
    expect(clientCommandSchema.safeParse({ type: "scene.background", data: { id: "main", image: "../etc/passwd" } }).success).toBe(false);
  });
});
