import { describe, expect, it } from "vitest";
import type { ClientCommand } from "@coc-vtt/shared";
import { Room, type Actor } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;

describe("장기적 광기 목록", () => {
  const setup = () => {
    let n = 0;
    const room = new Room("r", { newId: () => `id-${++n}` });
    room.join(kp);
    room.join(pl);
    room.handle(kp, cmd("session.start", {}));
    const r = room.handle(pl, cmd("character.add", { name: "서하", age: 27, occupation: "기자", characteristics: { STR: 50, CON: 60, SIZ: 60, DEX: 60, APP: 50, INT: 70, POW: 60, EDU: 70 }, luck: 55, skills: [], notes: "", backstory: "", possessions: "", weapons: [] }));
    if (!r.ok) throw new Error(r.message);
    return { room, id: room.snapshot(pl).characters[0]!.id };
  };

  it("목록을 저장하면 GM 스냅샷에만 담기고, 장기 굴림은 목록에서 하나를 뽑는다", () => {
    const { room, id } = setup();
    expect(room.handle(kp, cmd("madness.roll", { characterId: id, mode: "indefinite" })).ok).toBe(false); // 빈 목록
    expect(room.handle(pl, cmd("settings.madness", { entries: ["a"], indefinite: ["고소공포증"] })).ok).toBe(false);
    expect(room.handle(kp, cmd("settings.madness", { entries: ["a"], indefinite: ["고소공포증", "결벽증"] })).ok).toBe(true);
    expect(room.snapshot(kp).madnessIndefinite).toEqual(["고소공포증", "결벽증"]);
    expect(room.snapshot(pl).madnessIndefinite).toEqual([]);
    const r = room.handle(kp, cmd("madness.roll", { characterId: id, mode: "indefinite" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ev = r.out.find((o) => o.event.type === "madness.result")!.event;
      expect(ev.type === "madness.result" && ["고소공포증", "결벽증"].includes(ev.data.symptom) && ev.data.mode === "indefinite").toBe(true);
    }
  });

  it("indefinite를 생략한 저장은 장기 목록을 건드리지 않는다", () => {
    const { room } = setup();
    room.handle(kp, cmd("settings.madness", { entries: ["a"], indefinite: ["X"] }));
    room.handle(kp, cmd("settings.madness", { entries: ["b"] }));
    expect(room.snapshot(kp).madnessIndefinite).toEqual(["X"]);
  });
});
