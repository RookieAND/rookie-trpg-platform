import { describe, expect, it } from "vitest";
import type { ClientCommand, Rng } from "@coc-vtt/shared";
import { Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const seo: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const han: Actor = { userId: "pl2", name: "한도윤", role: "pl" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const seq = (...v: number[]): Rng => {
  let i = 0;
  return () => v[i++ % v.length]!;
};

const setup = (rng: Rng, str = 70, siz = 70) => {
  const room = new Room("r", { newId: () => `id-${++n}`, rng });
  for (const a of [kp, seo, han]) room.join(a);
  room.handle(kp, cmd("session.start", {}));
  const ev = must(
    room.handle(
      seo,
      cmd("character.add", {
        name: "윤서하",
        age: 27,
        occupation: "기자",
        characteristics: { STR: str, CON: 60, SIZ: siz, DEX: 60, APP: 50, INT: 70, POW: 60, EDU: 70 },
        luck: 55,
        skills: [{ name: "싸움(주먹)", value: 50, grown: false }],
        notes: "",
        backstory: "고향은 인천",
        possessions: "손전등",
        weapons: [
          { name: "주먹", skill: "싸움(주먹)", damage: "1d3+db" },
          { name: "칼", skill: "싸움(주먹)", damage: "1d4+2" },
        ],
      }),
    ),
  )[0]!.event;
  if (ev.type !== "character.added") throw new Error();
  return { room, id: ev.data.id };
};

const total = (outs: Out[]) => {
  const ev = outs.find((o) => o.event.type === "roll.result")!.event;
  if (ev.type !== "roll.result") throw new Error();
  const o = ev.data.outcome;
  if (o.kind !== "dice") throw new Error();
  return { total: o.total, label: ev.data.label, rolls: o.rolls };
};

describe("무기 피해 굴림", () => {
  it("+db는 피해 보너스를 더한다 (STR+SIZ 140 → 1d4)", () => {
    // 1d3: 0.99 → 3, db 1d4: 0.99 → 4
    const { room, id } = setup(seq(0.99, 0.99));
    const r = total(must(room.handle(seo, cmd("damage.roll", { characterId: id, weaponIndex: 0 }))));
    expect(r.rolls).toEqual([3, 4]);
    expect(r.total).toBe(7);
    expect(r.label).toBe("윤서하 · 주먹 피해");
  });

  it("피해 보너스가 0이면 기본 식만 굴린다", () => {
    const { room, id } = setup(seq(0.99, 0.99), 50, 70); // 120 → 0
    const r = total(must(room.handle(seo, cmd("damage.roll", { characterId: id, weaponIndex: 0 }))));
    expect(r.rolls).toEqual([3]);
    expect(r.total).toBe(3);
  });

  it("고정 보정이 있는 식도 굴린다", () => {
    const { room, id } = setup(seq(0));
    const r = total(must(room.handle(seo, cmd("damage.roll", { characterId: id, weaponIndex: 1 }))));
    expect(r.total).toBe(3); // 1d4(=1) + 2
  });

  it("없는 무기, 남의 캐릭터는 거절한다", () => {
    const { room, id } = setup(seq(0.5));
    const bad = room.handle(seo, cmd("damage.roll", { characterId: id, weaponIndex: 5 }));
    expect(bad.ok).toBe(false);
    const other = room.handle(han, cmd("damage.roll", { characterId: id, weaponIndex: 0 }));
    expect(other.ok).toBe(false);
  });
});

describe("시트 확장 op", () => {
  it("상태 토글, 소지품, 배경, 무기 교체가 반영된다", () => {
    const { room, id } = setup(seq(0.5));
    must(room.handle(seo, cmd("sheet.patch", { characterId: id, ops: [{ path: "condition", name: "majorWound", on: true }] })));
    must(room.handle(seo, cmd("sheet.patch", { characterId: id, ops: [{ path: "possessions", value: "권총" }, { path: "backstory", value: "새 배경" }] })));
    must(room.handle(kp, cmd("sheet.patch", { characterId: id, ops: [{ path: "weapons", value: [{ name: "총", skill: "사격(권총)", damage: "1d10" }] }] })));
    const snap = room.snapshot(kp);
    const c = snap.characters.find((x) => x.id === id)!;
    expect(c.conditions).toEqual(["majorWound"]);
    expect(c.possessions).toBe("권총");
    expect(c.backstory).toBe("새 배경");
    expect(c.weapons).toEqual([{ name: "총", skill: "사격(권총)", damage: "1d10" }]);
    must(room.handle(seo, cmd("sheet.patch", { characterId: id, ops: [{ path: "condition", name: "majorWound", on: false }] })));
    expect(room.snapshot(kp).characters.find((x) => x.id === id)!.conditions ?? []).toEqual([]);
  });

  it("다른 PL은 시트를 고칠 수 없다", () => {
    const { room, id } = setup(seq(0.5));
    const r = room.handle(han, cmd("sheet.patch", { characterId: id, ops: [{ path: "condition", name: "dying", on: true }] }));
    expect(r.ok).toBe(false);
  });
});
