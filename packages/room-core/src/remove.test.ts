import { describe, expect, it } from "vitest";
import type { ClientCommand } from "@coc-vtt/shared";
import { Room, type Actor } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;

describe("GM이 대화·굴림·기록 한 줄을 지운다", () => {
  const setup = () => {
    let n = 0;
    const room = new Room("r", { newId: () => `id-${++n}` });
    room.join(kp);
    room.join(pl);
    room.handle(kp, cmd("session.start", {}));
    return room;
  };

  it("대화: GM만 지울 수 있고, 지우면 다시 불러와도 없다", () => {
    const room = setup();
    const sent = room.handle(pl, cmd("chat.send", { text: "안녕" }));
    expect(sent.ok).toBe(true);
    const seq = room.chatHistory(pl, 10)[0]!.seq;
    const no = room.handle(pl, cmd("chat.remove", { seq }));
    expect(no.ok).toBe(false);
    const yes = room.handle(kp, cmd("chat.remove", { seq }));
    expect(yes.ok).toBe(true);
    expect(room.chatHistory(pl, 10)).toHaveLength(0);
    expect(room.handle(kp, cmd("chat.remove", { seq })).ok).toBe(false);
  });

  it("굴림: GM만 지울 수 있다", () => {
    const room = setup();
    room.handle(pl, cmd("roll.request", { expr: "1d100", secret: false }));
    const snap = room.snapshot(pl);
    const id = snap.rolls[0]!.id;
    expect(room.handle(pl, cmd("roll.remove", { id })).ok).toBe(false);
    expect(room.handle(kp, cmd("roll.remove", { id })).ok).toBe(true);
    expect(room.snapshot(pl).rolls).toHaveLength(0);
  });

  it("세션 기록: GM만 지울 수 있다", () => {
    const room = setup();
    const page = room.logFor({ userId: "kp1", role: "kp" });
    const n = page.entries[0]!.n;
    expect(room.handle(pl, cmd("log.remove", { n })).ok).toBe(false);
    expect(room.handle(kp, cmd("log.remove", { n })).ok).toBe(true);
    expect(room.logFor({ userId: "kp1", role: "kp" }).entries.find((e) => e.n === n)).toBeUndefined();
  });
});
