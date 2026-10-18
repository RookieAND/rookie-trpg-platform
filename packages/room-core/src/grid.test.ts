import { describe, expect, it } from "vitest";
import type { ClientCommand } from "@coc-vtt/shared";
import { inAudience, Room, type Actor } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;

const setup = () => {
  const room = new Room("r", { newId: (() => { let n = 0; return () => `g-${++n}`; })() });
  room.join(kp);
  room.join(pl);
  room.handle(kp, cmd("session.start", {}));
  return room;
};

describe("장면 격자", () => {
  it("처음에는 격자가 없다", () => {
    expect(setup().snapshot(pl).scenes[0]!.grid).toBeUndefined();
  });

  it("GM만 바꾸고, GM과 PL 모두 받는다", () => {
    const room = setup();
    expect(room.handle(pl, cmd("scene.grid", { id: "main", size: 50, show: true, snap: true })).ok).toBe(false);
    const r = room.handle(kp, cmd("scene.grid", { id: "main", size: 50, show: true, snap: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.out.filter((o) => inAudience(o.audience, pl)).map((o) => o.event.type)).toEqual(["scene.updated"]);
    expect(room.snapshot(pl).scenes[0]!.grid).toEqual({ size: 50, show: true, snap: true });
    expect(room.snapshot(kp).scenes[0]!.grid).toEqual({ size: 50, show: true, snap: true });
  });

  it("없는 장면은 거절하고, 복제하면 격자도 따라간다", () => {
    const room = setup();
    expect(room.handle(kp, cmd("scene.grid", { id: "nope", size: 40, show: false, snap: false })).ok).toBe(false);
    room.handle(kp, cmd("scene.grid", { id: "main", size: 60, show: true, snap: false }));
    room.handle(kp, cmd("scene.duplicate", { id: "main" }));
    const copy = room.snapshot(kp).scenes.find((s) => s.id !== "main")!;
    expect(copy.grid).toEqual({ size: 60, show: true, snap: false });
  });
});
