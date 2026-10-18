import { describe, expect, it } from "vitest";
import type { ClientCommand } from "@coc-vtt/shared";
import { Room, type Actor } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl: Actor = { userId: "pl1", name: "서하", role: "pl" };
const spec: Actor = { userId: "sp1", name: "관전", role: "spectator" };
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;

const setup = () => {
  const room = new Room("r", { newId: () => "ask-1", rng: () => 0.5 });
  for (const a of [kp, pl, spec]) room.join(a);
  room.handle(kp, cmd("session.start", {}));
  return room;
};

describe("판정 요청", () => {
  it("KP가 요청하면 모두에게 알림이 가고 이름은 다듬어진다", () => {
    const r = setup().handle(kp, cmd("roll.ask", { name: " 관찰력 ", difficulty: "hard" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = r.out.find((o) => o.event.type === "roll.asked")!;
    expect(ev.event).toMatchObject({ data: { id: "ask-1", name: "관찰력", difficulty: "hard" } });
    expect(ev.audience.roles).toContain("pl");
  });
  it("특정 PL에게만 보낼 수 있고 PL이 아닌 대상은 거절한다", () => {
    const room = setup();
    expect(room.handle(kp, cmd("roll.ask", { name: "듣기", targetUserId: "pl1" })).ok).toBe(true);
    const bad = room.handle(kp, cmd("roll.ask", { name: "듣기", targetUserId: "sp1" }));
    expect(bad.ok).toBe(false);
  });
  it("KP가 아니면 요청할 수 없다", () => {
    const room = setup();
    expect(room.handle(pl, cmd("roll.ask", { name: "듣기" })).ok).toBe(false);
    expect(room.handle(spec, cmd("roll.ask", { name: "듣기" })).ok).toBe(false);
  });
});
