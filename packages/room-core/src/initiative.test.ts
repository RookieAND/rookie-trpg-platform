import { describe, expect, it } from "vitest";
import type { ClientCommand, Initiative } from "@coc-vtt/shared";
import { Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const seo: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const han: Actor = { userId: "pl2", name: "한도윤", role: "pl" };
const spec: Actor = { userId: "sp1", name: "구경꾼", role: "spectator" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const init = (outs: Out[]): Initiative | null => {
  const ev = outs[0]!.event;
  if (ev.type !== "initiative.updated") throw new Error();
  return ev.data.initiative;
};

const addChar = (room: Room, who: Actor, name: string, dex: number) =>
  must(
    room.handle(
      who,
      cmd("character.add", {
        name,
        age: 30,
        occupation: "",
        characteristics: { STR: 50, CON: 50, SIZ: 50, DEX: dex, APP: 50, INT: 50, POW: 50, EDU: 50 },
        luck: 50,
        skills: [],
        notes: "",
        backstory: "",
        possessions: "",
        weapons: [],
      }),
    ),
  );

const setup = () => {
  const room = new Room("r", { newId: () => `id-${++n}`, rng: () => 0.5 });
  for (const a of [kp, seo, han, spec]) room.join(a);
  room.handle(kp, cmd("session.start", {}));
  addChar(room, seo, "윤서하", 60);
  addChar(room, han, "한도윤", 75);
  return room;
};

describe("전투 순서", () => {
  it("시작하면 시트의 DEX 높은 순으로 서고 모두에게 보인다", () => {
    const room = setup();
    const out = must(room.handle(kp, cmd("initiative.start", {})));
    expect(out[0]!.audience.roles).toEqual(expect.arrayContaining(["kp", "pl", "spectator"]));
    const i = init(out)!;
    expect(i.entries.map((e) => [e.name, e.dex])).toEqual([["한도윤", 75], ["윤서하", 60]]);
    expect([i.turn, i.round]).toEqual([0, 1]);
    expect(room.snapshot(spec).initiative?.entries).toHaveLength(2);
  });

  it("GM만 다룰 수 있다", () => {
    const room = setup();
    for (const c of [cmd("initiative.start", {}), cmd("initiative.next", {}), cmd("initiative.end", {}), cmd("initiative.add", { name: "x", dex: 1 })]) {
      expect(room.handle(seo, c).ok).toBe(false);
    }
  });

  it("NPC를 넣으면 DEX 순서에 끼고, 같은 DEX는 먼저 넣은 쪽이 앞이다", () => {
    const room = setup();
    must(room.handle(kp, cmd("initiative.start", {})));
    must(room.handle(kp, cmd("initiative.add", { name: "광신도", dex: 60 })));
    const i = init(must(room.handle(kp, cmd("initiative.add", { name: "괴물", dex: 90 }))))!;
    expect(i.entries.map((e) => e.name)).toEqual(["괴물", "한도윤", "윤서하", "광신도"]);
  });

  it("다음을 누르면 차례가 넘어가고 한 바퀴 돌면 라운드가 오른다", () => {
    const room = setup();
    must(room.handle(kp, cmd("initiative.start", {})));
    expect(init(must(room.handle(kp, cmd("initiative.next", {}))))).toMatchObject({ turn: 1, round: 1 });
    expect(init(must(room.handle(kp, cmd("initiative.next", {}))))).toMatchObject({ turn: 0, round: 2 });
  });

  it("중간에 사람을 넣어도 지금 차례인 사람은 그대로다", () => {
    const room = setup();
    must(room.handle(kp, cmd("initiative.start", {})));
    must(room.handle(kp, cmd("initiative.next", {}))); // 윤서하 차례
    const i = init(must(room.handle(kp, cmd("initiative.add", { name: "괴물", dex: 90 }))))!;
    expect(i.entries[i.turn]!.name).toBe("윤서하");
  });

  it("DEX를 고치면 다시 정렬하고 지금 차례는 유지한다", () => {
    const room = setup();
    const start = init(must(room.handle(kp, cmd("initiative.start", {}))))!;
    const seoEntry = start.entries.find((e) => e.name === "윤서하")!;
    must(room.handle(kp, cmd("initiative.next", {}))); // 윤서하 차례
    const i = init(must(room.handle(kp, cmd("initiative.dex", { id: seoEntry.id, dex: 99 }))))!;
    expect(i.entries.map((e) => e.name)).toEqual(["윤서하", "한도윤"]);
    expect(i.entries[i.turn]!.name).toBe("윤서하");
  });

  it("지우면 차례가 어긋나지 않고, 마지막 차례를 지우면 다음 라운드로 간다", () => {
    const room = setup();
    const start = init(must(room.handle(kp, cmd("initiative.start", {}))))!;
    must(room.handle(kp, cmd("initiative.next", {}))); // 윤서하(마지막) 차례
    const first = start.entries[0]!;
    const afterFirst = init(must(room.handle(kp, cmd("initiative.remove", { id: first.id }))))!;
    expect(afterFirst.entries.map((e) => e.name)).toEqual(["윤서하"]);
    expect(afterFirst.turn).toBe(0);
    const last = init(must(room.handle(kp, cmd("initiative.remove", { id: afterFirst.entries[0]!.id }))))!;
    expect(last.entries).toHaveLength(0);
    expect(room.handle(kp, cmd("initiative.next", {})).ok).toBe(false);
    expect(room.handle(kp, cmd("initiative.remove", { id: "nope" })).ok).toBe(false);
  });

  it("끝내면 사라지고, 없을 때 추가는 거절한다", () => {
    const room = setup();
    expect(room.handle(kp, cmd("initiative.add", { name: "x", dex: 1 })).ok).toBe(false);
    must(room.handle(kp, cmd("initiative.start", {})));
    expect(init(must(room.handle(kp, cmd("initiative.end", {}))))).toBeNull();
    expect(room.snapshot(kp).initiative).toBeNull();
  });

  it("저장했다 복원해도 남는다", () => {
    const room = setup();
    must(room.handle(kp, cmd("initiative.start", {})));
    must(room.handle(kp, cmd("initiative.next", {})));
    const back = Room.fromData(room.toData(), { newId: () => `id-${++n}`, rng: () => 0.5 });
    expect(back.snapshot(kp).initiative).toMatchObject({ turn: 1, round: 1 });
  });
});
