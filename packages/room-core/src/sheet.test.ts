import { describe, expect, it } from "vitest";
import type { ClientCommand, Rng } from "@coc-vtt/shared";
import { inAudience, Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const seo: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const han: Actor = { userId: "pl2", name: "한도윤", role: "pl" };
const spec: Actor = { userId: "sp1", name: "구경꾼", role: "spectator" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) =>
  ({ type, data }) as ClientCommand;

const room0 = (opts: ConstructorParameters<typeof Room>[1] = {}, start = true) => {
  const room = new Room("r", { newId: () => `id-${++n}`, ...opts });
  for (const a of [kp, seo, han, spec]) room.join(a);
  if (start) room.handle(kp, cmd("session.start", {}));
  return room;
};

function must(r: ReturnType<Room["handle"]>): Out[] {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
}

const sheet = (over: Record<string, unknown> = {}) =>
  ({
    name: "윤서하",
    age: 27,
    occupation: "기자",
    characteristics: { STR: 50, CON: 60, SIZ: 60, DEX: 60, APP: 50, INT: 70, POW: 60, EDU: 70 },
    luck: 55,
    skills: [
      { name: "도서관 이용", value: 60, grown: false },
      { name: "심리학", value: 40, grown: false },
    ],
    ...over,
  }) as Extract<ClientCommand, { type: "character.add" }>["data"];

const add = (room: Room, who: Actor, data = sheet()) => {
  const outs = must(room.handle(who, cmd("character.add", data)));
  const ev = outs[0]!.event;
  if (ev.type !== "character.added") throw new Error("no add");
  return { outs, c: ev.data };
};

const fixed = (...values: number[]): Rng => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("캐릭터 등록", () => {
  it("주인과 GM만 시트를 받고, 다른 PL과 관전자는 못 받는다", () => {
    const room = room0();
    const { outs } = add(room, seo);
    expect(outs.filter((o) => inAudience(o.audience, seo))).toHaveLength(1);
    expect(outs.filter((o) => inAudience(o.audience, kp))).toHaveLength(1);
    expect(outs.filter((o) => inAudience(o.audience, han))).toHaveLength(0);
    expect(outs.filter((o) => inAudience(o.audience, spec))).toHaveLength(0);
  });

  it("현재 HP·MP·SAN은 특성치에서 계산한 값으로 시작한다", () => {
    const { c } = add(room0(), seo);
    expect(c).toMatchObject({ hp: 12, mp: 12, san: 60, luck: 55, ownerId: "pl1", rev: 0 });
  });

  it("현재값을 주면 최대치로 잘라서 받아 준다", () => {
    const { c } = add(room0(), seo, sheet({ hp: 50, mp: 3, san: 20 }));
    expect(c).toMatchObject({ hp: 12, mp: 3, san: 20 });
  });

  it("세션 시작 전에도 PL이 미리 등록할 수 있다", () => {
    const room = room0({}, false);
    expect(room.handle(seo, cmd("character.add", sheet())).ok).toBe(true);
    expect(room.handle(seo, cmd("sheet.patch", { characterId: "x", ops: [{ path: "hp", delta: -1 }] }))).toMatchObject({ code: "idle" });
  });

  it("PL은 한 명만, 관전자는 못 만든다", () => {
    const room = room0();
    add(room, seo);
    expect(room.handle(seo, cmd("character.add", sheet({ name: "둘째" })))).toMatchObject({ ok: false, code: "bad_sheet" });
    expect(room.handle(spec, cmd("character.add", sheet()))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("GM은 다른 사람 몫(NPC 포함)을 만들 수 있고 PL은 못 한다", () => {
    const room = room0();
    expect(add(room, kp, sheet({ ownerId: "pl2" })).c.ownerId).toBe("pl2");
    expect(room.handle(seo, cmd("character.add", sheet({ ownerId: "pl2" })))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("PL은 첫 세션을 시작하기 전에는 자기 캐릭터를 뺄 수 있다(남의 것은 못 뺀다)", () => {
    const room = room0({}, false);
    const { c } = add(room, seo);
    expect(room.handle(han, cmd("character.remove", { id: c.id }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(room.handle(seo, cmd("character.remove", { id: c.id })).ok).toBe(true);
    expect(room.snapshot(seo).characters).toEqual([]);
    // 다시 고를 수 있다
    expect(add(room, seo).c.ownerId).toBe(seo.userId);
  });

  it("세션이 한 번이라도 시작됐다면 PL은 못 뺀다", () => {
    const room = room0({}, false);
    const { c } = add(room, seo);
    room.handle(kp, cmd("session.start", {}));
    room.handle(kp, cmd("session.end", { growth: false }));
    expect(room.handle(seo, cmd("character.remove", { id: c.id }))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("지우기는 GM만 한다", () => {
    const room = room0();
    const { c } = add(room, seo);
    expect(room.handle(seo, cmd("character.remove", { id: c.id }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(room.handle(kp, cmd("character.remove", { id: c.id })).ok).toBe(true);
    expect(room.snapshot(seo).characters).toEqual([]);
  });
});

describe("sheet.patch", () => {
  const patch = (room: Room, who: Actor, id: string, ops: Extract<ClientCommand, { type: "sheet.patch" }>["data"]["ops"]) =>
    room.handle(who, cmd("sheet.patch", { characterId: id, ops }));

  it("HP 증감은 0과 최대치 사이로 잘린다", () => {
    const room = room0();
    const { c } = add(room, seo);
    let out = must(patch(room, seo, c.id, [{ path: "hp", delta: -5 }]));
    expect(out[0]!.event).toMatchObject({ type: "character.updated", data: { hp: 7, rev: 1 } });
    out = must(patch(room, seo, c.id, [{ path: "hp", delta: -50 }]));
    expect(out[0]!.event).toMatchObject({ data: { hp: 0 } });
    out = must(patch(room, seo, c.id, [{ path: "hp", delta: 30 }]));
    expect(out[0]!.event).toMatchObject({ data: { hp: 12 } });
  });

  it("SAN, 행운은 99를 넘지 않는다", () => {
    const room = room0();
    const { c } = add(room, seo);
    const out = must(patch(room, seo, c.id, [{ path: "san", value: 150 }, { path: "luck", delta: 80 }]));
    expect(out[0]!.event).toMatchObject({ data: { san: 99, luck: 99 } });
  });

  it("GM은 기능 값 변경·새 기능 추가·성장 표시를 할 수 있다", () => {
    const room = room0();
    const { c } = add(room, seo);
    const out = must(
      patch(room, kp, c.id, [
        { path: "skill", name: "심리학", delta: 5, grown: true },
        { path: "skill", name: "크툴루 신화", value: 5 },
      ]),
    );
    const data = (out[0]!.event as { data: { skills: Record<string, { value: number; grown: boolean }> } }).data;
    expect(data.skills["심리학"]).toEqual({ value: 45, grown: true });
    expect(data.skills["크툴루 신화"]).toEqual({ value: 5, grown: false });
  });

  it("PL은 자기 기능의 성장 표시만 바꿀 수 있고, 값(지정·증감)이나 새 기능은 거절된다", () => {
    const room = room0();
    const { c } = add(room, seo);
    must(patch(room, seo, c.id, [{ path: "skill", name: "심리학", grown: true }]));
    expect(room.snapshot(seo).characters[0]!.skills["심리학"]).toEqual({ value: 40, grown: true });
    for (const op of [
      { path: "skill", name: "심리학", value: 90 },
      { path: "skill", name: "심리학", delta: 5 },
      { path: "skill", name: "심리학", delta: 5, grown: false },
      { path: "skill", name: "크툴루 신화", value: 90 },
    ] as const) {
      expect(patch(room, seo, c.id, [op]), JSON.stringify(op)).toMatchObject({ ok: false, code: "forbidden" });
    }
    expect(room.snapshot(seo).characters[0]!.skills["심리학"]).toEqual({ value: 40, grown: true });
    expect(room.snapshot(seo).characters[0]!.skills["크툴루 신화"]).toBeUndefined();
  });

  it("PL이 무기 목록을 직접 바꾸려 하면 거절된다", () => {
    const room = room0();
    const { c } = add(room, seo);
    expect(patch(room, seo, c.id, [{ path: "weapons", value: [{ name: "대포", skill: "사격(권총)", damage: "9d99" }] }])).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("없는 기능의 성장 표시만 바꾸려 하면 거절하고 아무것도 바꾸지 않는다", () => {
    const room = room0();
    const { c } = add(room, seo);
    const r = patch(room, seo, c.id, [{ path: "hp", delta: -3 }, { path: "skill", name: "없는기능", grown: true }]);
    expect(r).toMatchObject({ ok: false, code: "bad_sheet" });
    expect(room.snapshot(seo).characters[0]).toMatchObject({ hp: 12, rev: 0 });
  });

  it("남의 시트는 못 바꾸고 존재 여부도 숨긴다. GM은 바꿀 수 있다", () => {
    const room = room0();
    const { c } = add(room, seo);
    expect(patch(room, han, c.id, [{ path: "hp", delta: -1 }])).toMatchObject({ ok: false, code: "not_found" });
    expect(patch(room, kp, c.id, [{ path: "hp", delta: -1 }]).ok).toBe(true);
  });

  it("변경은 주인과 GM에게만 간다", () => {
    const room = room0();
    const { c } = add(room, seo);
    const out = must(patch(room, kp, c.id, [{ path: "hp", delta: -1 }]));
    expect(out.filter((o) => inAudience(o.audience, seo))).toHaveLength(1);
    expect(out.filter((o) => inAudience(o.audience, han))).toHaveLength(0);
  });

  it("일시정지 중에는 막히고, 초당 10회를 넘기면 제한된다", () => {
    let t = 0;
    const room = room0({ now: () => t });
    const { c } = add(room, seo);
    for (let i = 0; i < 10; i++) expect(patch(room, seo, c.id, [{ path: "notes", value: `${i}` }]).ok).toBe(true);
    expect(patch(room, seo, c.id, [{ path: "notes", value: "x" }])).toMatchObject({ ok: false, code: "rate_limited" });
    t = 1500;
    room.leave("kp1");
    room.expireKpAway(); // 유예가 지나면 자동 정지
    room.join(spec); // GM이 아닌 접속으로는 풀리지 않는다
    expect(patch(room, seo, c.id, [{ path: "notes", value: "y" }])).toMatchObject({ ok: false, code: "paused" });
  });
});

describe("시트로 굴리기", () => {
  const rollSkill = (room: Room, who: Actor, id: string, name: string, extra: Record<string, unknown> = {}) =>
    room.handle(who, cmd("roll.request", { secret: false, skill: { characterId: id, name, bonus: 0, ...extra } }));

  it("시트의 값으로 CC를 굴리고 라벨을 남긴다", () => {
    const room = room0({ rng: fixed(0.39) }); // 40 (60의 절반 30보다 크므로 보통 성공)
    const { c } = add(room, seo);
    const out = must(rollSkill(room, seo, c.id, "도서관 이용"));
    const entry = (out[0]!.event as { data: { expr: string; label?: string; outcome: { level?: string } } }).data;
    expect(entry.expr).toBe("CC<=60");
    expect(entry.label).toBe("윤서하 · 도서관 이용");
    expect(entry.outcome.level).toBe("regular");
  });

  it("보너스 주사위와 난이도를 식에 반영한다", () => {
    const room = room0();
    const { c } = add(room, seo);
    const out = must(rollSkill(room, seo, c.id, "심리학", { bonus: 1, difficulty: "hard" }));
    expect((out[0]!.event as { data: { expr: string } }).data.expr).toBe("CC(1)<=40h");
  });

  it("특성치 이름과 행운으로도 굴릴 수 있다", () => {
    const room = room0();
    const { c } = add(room, seo);
    expect((must(rollSkill(room, seo, c.id, "STR"))[0]!.event as { data: { expr: string } }).data.expr).toBe("CC<=50");
    expect((must(rollSkill(room, seo, c.id, "행운"))[0]!.event as { data: { expr: string } }).data.expr).toBe("CC<=55");
  });

  it("없는 기능이나 남의 캐릭터는 굴릴 수 없다", () => {
    const room = room0();
    const { c } = add(room, seo);
    expect(rollSkill(room, seo, c.id, "없음")).toMatchObject({ ok: false, code: "bad_roll" });
    expect(rollSkill(room, han, c.id, "STR")).toMatchObject({ ok: false, code: "not_found" });
  });

  it("GM의 비밀 굴림도 시트로 굴릴 수 있다", () => {
    const room = room0();
    const { c } = add(room, kp, sheet());
    const out = must(room.handle(kp, cmd("roll.request", { secret: true, skill: { characterId: c.id, name: "STR", bonus: 0 } })));
    expect(out.map((o) => o.event.type)).toEqual(["roll.result", "roll.hidden"]);
  });
});

describe("저장과 snapshot", () => {
  it("snapshot에는 내가 볼 수 있는 시트만 담긴다", () => {
    const room = room0();
    add(room, seo);
    add(room, han, sheet({ name: "한도윤" }));
    expect(room.snapshot(seo).characters.map((c) => c.name)).toEqual(["윤서하"]);
    expect(room.snapshot(han).characters.map((c) => c.name)).toEqual(["한도윤"]);
    expect(room.snapshot(kp).characters).toHaveLength(2);
    expect(room.snapshot(spec).characters).toHaveLength(0);
  });

  it("저장 데이터로 시트를 복원하고, 시트가 없는 옛 데이터도 읽는다", () => {
    const room = room0();
    add(room, seo);
    const data = room.toData();
    expect(Room.fromData(data).snapshot(kp).characters).toHaveLength(1);
    const { characters: _drop, ...old } = data;
    expect(Room.fromData(old).snapshot(kp).characters).toEqual([]);
  });
});

describe("세션 전 시트 글 편집", () => {
  it("PL은 세션 전에도 소지품·배경·메모를 고칠 수 있지만 수치는 못 바꾼다", () => {
    const room = room0({}, false);
    const { c } = add(room, seo);
    const text = room.handle(seo, cmd("sheet.patch", { characterId: c.id, ops: [{ path: "possessions", value: "손전등" }, { path: "backstory", value: "기자" }, { path: "notes", value: "메모" }] }));
    expect(text.ok).toBe(true);
    const stat = room.handle(seo, cmd("sheet.patch", { characterId: c.id, ops: [{ path: "hp", delta: -1 }] }));
    expect(stat.ok).toBe(false);
    if (!stat.ok) expect(stat.code).toBe("idle");
    const mixed = room.handle(seo, cmd("sheet.patch", { characterId: c.id, ops: [{ path: "notes", value: "x" }, { path: "san", delta: -1 }] }));
    expect(mixed.ok).toBe(false);
  });
  it("남의 캐릭터 글은 세션 전에도 못 고친다", () => {
    const room = room0({}, false);
    const { c } = add(room, seo);
    expect(room.handle(han, cmd("sheet.patch", { characterId: c.id, ops: [{ path: "notes", value: "x" }] })).ok).toBe(false);
  });
});
