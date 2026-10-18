import { describe, expect, it } from "vitest";
import type { ClientCommand, Rng } from "@coc-vtt/shared";
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
const seq = (...v: number[]): Rng => {
  let i = 0;
  return () => v[i++ % v.length]!;
};

const setup = (rng: Rng) => {
  const room = new Room("r", { newId: () => `id-${++n}`, rng });
  for (const a of [kp, seo, han, spec]) room.join(a);
  room.handle(kp, cmd("session.start", {}));
  const ev = must(
    room.handle(
      seo,
      cmd("character.add", {
        name: "윤서하",
        age: 27,
        occupation: "기자",
        characteristics: { STR: 50, CON: 60, SIZ: 60, DEX: 60, APP: 50, INT: 70, POW: 60, EDU: 70 },
        luck: 55,
        skills: [],
        notes: "",
        backstory: "",
        possessions: "",
        weapons: [],
      }),
    ),
  )[0]!.event;
  if (ev.type !== "character.added") throw new Error();
  return { room, id: ev.data.id };
};

const types = (outs: Out[]) => outs.map((o) => o.event.type);
const sheetOf = (outs: Out[]) => {
  const ev = outs.find((o) => o.event.type === "character.updated")!.event;
  if (ev.type !== "character.updated") throw new Error();
  return ev.data;
};

describe("SAN 체크", () => {
  it("시트 주인이 굴리면 로그에 남고 SAN이 깎인다", () => {
    // 실패(89) → 1d6 0.5 → 4
    const { room, id } = setup(seq(0.9, 0.8, 0.5));
    const outs = must(room.handle(seo, cmd("san.check", { characterId: id, loss: "0/1d6" })));
    expect(types(outs)).toEqual(["roll.result", "character.updated"]);
    const log = outs[0]!.event;
    if (log.type !== "roll.result") throw new Error();
    expect(log.data.label).toBe("윤서하 · SAN 체크");
    expect(log.data.outcome).toMatchObject({ kind: "san", loss: 4, before: 60, after: 56 });
    expect(sheetOf(outs)).toMatchObject({ san: 56, sanDay: { start: 60, lost: 4 } });
  });

  it("남의 시트는 못 굴리고 관전자도 못 굴린다. GM은 가능하다", () => {
    const { room, id } = setup(seq(0.3, 0.2));
    expect(room.handle(han, cmd("san.check", { characterId: id, loss: "0/1d6" })).ok).toBe(false);
    expect(room.handle(spec, cmd("san.check", { characterId: id, loss: "0/1d6" })).ok).toBe(false);
    expect(room.handle(kp, cmd("san.check", { characterId: id, loss: "0/1d6" })).ok).toBe(true);
  });

  it("잘못된 손실 식은 거절하고 상태를 바꾸지 않는다", () => {
    const { room, id } = setup(seq(0.9));
    const r = room.handle(seo, cmd("san.check", { characterId: id, loss: "1d6" }));
    expect(r.ok).toBe(false);
    expect(room.snapshot(seo).characters[0]!.san).toBe(60);
  });

  it("5 이상 잃고 INT 판정에 성공하면 일시적 광기가 시트에 남는다", () => {
    // 실패(89), 1d10 0.6→7, INT 11 성공
    const { room, id } = setup(seq(0.9, 0.8, 0.6, 0.1, 0.1));
    const outs = must(room.handle(seo, cmd("san.check", { characterId: id, loss: "0/1d10" })));
    expect(sheetOf(outs).madness).toBe("temporary");
  });

  it("광기는 더 무거운 쪽으로만 올라간다", () => {
    const { room, id } = setup(seq(0.9, 0.8, 0.6, 0.1, 0.1, 0.9, 0.8, 0.1));
    must(room.handle(seo, cmd("san.check", { characterId: id, loss: "0/1d10" }))); // 일시적
    // 두 번째: 작은 손실(1d6 → 1)이라 새 광기 없음. 일시적 광기는 그대로.
    const outs = must(room.handle(seo, cmd("san.check", { characterId: id, loss: "0/1d6" })));
    expect(sheetOf(outs).madness).toBe("temporary");
  });
});

describe("광기 상태 관리", () => {
  it("GM만 광기를 해제할 수 있다", () => {
    const { room, id } = setup(seq(0.9, 0.8, 0.6, 0.1, 0.1));
    must(room.handle(seo, cmd("san.check", { characterId: id, loss: "0/1d10" })));
    const mine = room.handle(seo, cmd("sheet.patch", { characterId: id, ops: [{ path: "madness", value: "none" }] }));
    expect(mine.ok).toBe(false);
    const outs = must(room.handle(kp, cmd("sheet.patch", { characterId: id, ops: [{ path: "madness", value: "none" }] })));
    expect(sheetOf(outs).madness).toBeUndefined();
  });

  it("하루가 지나면 하루 손실이 초기화된다(GM만)", () => {
    const { room, id } = setup(seq(0.9, 0.8, 0.5));
    must(room.handle(seo, cmd("san.check", { characterId: id, loss: "0/1d6" })));
    expect(room.handle(seo, cmd("san.newDay", {})).ok).toBe(false);
    const outs = must(room.handle(kp, cmd("san.newDay", {})));
    expect(sheetOf(outs)).toMatchObject({ san: 56, sanDay: { start: 56, lost: 0 } });
    // 바뀐 게 없으면 다시 알리지 않는다
    expect(must(room.handle(kp, cmd("san.newDay", {})))).toHaveLength(0);
  });

  it("저장하고 복원해도 광기와 하루 기록이 남는다", () => {
    const { room, id } = setup(seq(0.9, 0.8, 0.6, 0.1, 0.1));
    must(room.handle(seo, cmd("san.check", { characterId: id, loss: "0/1d10" })));
    const back = Room.fromData(room.toData(), { newId: () => `id-${++n}` });
    back.join(kp);
    const c = back.snapshot(kp).characters[0]!;
    expect(c.madness).toBe("temporary");
    expect(c.sanDay).toEqual({ start: 60, lost: 7 });
  });
});

describe("광기 증상표", () => {
  const table = ["공포에 얼어붙는다", "비명을 지르며 달아난다", "누군가를 공격한다"];

  it("GM만 증상표를 바꾸고, 증상표는 GM에게만 보인다", () => {
    const { room } = setup(seq(0.5));
    expect(room.handle(seo, cmd("settings.madness", { entries: table })).ok).toBe(false);
    const outs = must(room.handle(kp, cmd("settings.madness", { entries: table })));
    expect(outs[0]!.audience).toEqual({ roles: ["kp"] });
    expect(room.snapshot(kp).madnessTable).toEqual(table);
    expect(room.snapshot(seo).madnessTable).toEqual([]);
  });

  it("증상 하나와 지속 시간을 굴리고, 시트 주인과 GM에게만 알린다", () => {
    // 인덱스 0.5 → 3개 중 2번째(1), 지속 0.2 → 3
    const { room, id } = setup(seq(0.5, 0.2));
    must(room.handle(kp, cmd("settings.madness", { entries: table })));
    const outs = must(room.handle(kp, cmd("madness.roll", { characterId: id, mode: "summary" })));
    const ev = outs[0]!.event;
    if (ev.type !== "madness.result") throw new Error();
    expect(ev.data).toMatchObject({ mode: "summary", duration: 3, index: 1, symptom: "비명을 지르며 달아난다", name: "윤서하" });
    expect(outs[0]!.audience).toEqual({ roles: ["kp"], users: ["pl1"] });
  });

  it("증상표가 비었거나 GM이 아니면 굴릴 수 없다", () => {
    const { room, id } = setup(seq(0.5));
    expect(room.handle(kp, cmd("madness.roll", { characterId: id, mode: "realtime" })).ok).toBe(false);
    must(room.handle(kp, cmd("settings.madness", { entries: table })));
    expect(room.handle(seo, cmd("madness.roll", { characterId: id, mode: "realtime" })).ok).toBe(false);
  });

  it("저장하고 복원해도 증상표가 남는다", () => {
    const { room } = setup(seq(0.5));
    must(room.handle(kp, cmd("settings.madness", { entries: table })));
    const back = Room.fromData(room.toData(), { newId: () => `id-${++n}` });
    expect(back.snapshot(kp).madnessTable).toEqual(table);
  });
});

describe("시트에서 직접 바꾼 SAN", () => {
  const mk = () => {
    const room = new Room("r", { newId: () => `m-${++mid}`, rng: () => 0.5 });
    const gm: Actor = { userId: "kp1", name: "하늘", role: "kp" };
    const pl: Actor = { userId: "pl1", name: "서하", role: "pl" };
    room.join(gm);
    room.join(pl);
    room.handle(gm, { type: "session.start", data: {} } as never);
    const ev = room.handle(pl, {
      type: "character.add",
      data: { name: "서하", age: 27, occupation: "", characteristics: { STR: 50, CON: 60, SIZ: 60, DEX: 60, APP: 50, INT: 70, POW: 50, EDU: 70 }, luck: 50, skills: [], notes: "", backstory: "", possessions: "", weapons: [] },
    } as never);
    if (!ev.ok) throw new Error(ev.message);
    const e = ev.out[0]!.event;
    if (e.type !== "character.added") throw new Error();
    const patch = (who: Actor, ops: unknown[]) => {
      const r = room.handle(who, { type: "sheet.patch", data: { characterId: e.data.id, ops } } as never);
      if (!r.ok) throw new Error(r.message);
      return room.snapshot(gm).characters[0]!;
    };
    return { patch, gm, pl };
  };
  let mid = 0;

  it("줄이면 오늘 손실이 늘고, 올리면 그만큼 줄어든다", () => {
    const { patch, pl } = mk(); // SAN 50, 임계 10
    expect(patch(pl, [{ path: "san", delta: -3 }]).sanDay).toEqual({ start: 50, lost: 3 });
    expect(patch(pl, [{ path: "san", delta: -2 }]).sanDay).toEqual({ start: 50, lost: 5 });
    expect(patch(pl, [{ path: "san", delta: 1 }]).sanDay).toEqual({ start: 50, lost: 4 });
  });

  it("하루 손실이 시작 SAN의 1/5 이상이면 장기 광기가 된다", () => {
    const { patch, pl } = mk();
    expect(patch(pl, [{ path: "san", value: 41 }]).madness).toBeUndefined();
    const c = patch(pl, [{ path: "san", value: 40 }]);
    expect(c.sanDay).toEqual({ start: 50, lost: 10 });
    expect(c.madness).toBe("indefinite");
  });

  it("SAN 0은 영구 광기이고, 이미 더 무거운 광기는 낮추지 않는다", () => {
    const { patch, pl, gm } = mk();
    patch(gm, [{ path: "madness", value: "permanent" }]);
    expect(patch(pl, [{ path: "san", value: 40 }]).madness).toBe("permanent");
    const m = mk();
    expect(m.patch(m.pl, [{ path: "san", value: 0 }]).madness).toBe("permanent");
  });
});
