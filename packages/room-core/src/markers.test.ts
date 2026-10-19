import { describe, expect, it } from "vitest";
import { parseScenario, type ClientCommand, type GameObject, type Marker } from "@coc-vtt/shared";
import { Room, buildExport, inAudience, migrateRoomData, type Actor, type Out } from "./index";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl1: Actor = { userId: "pl1", name: "서하", role: "pl" };
const pl2: Actor = { userId: "pl2", name: "도윤", role: "pl" };
const spec: Actor = { userId: "sp1", name: "관전", role: "spectator" };
const everyone = [kp, pl1, pl2, spec];

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const marks = (room: Room, who: Actor, id: string): Marker[] => room.snapshot(who).objects.find((o) => o.id === id)?.markers ?? [];
const keys = (room: Room, who: Actor, id: string) => marks(room, who, id).map((m) => m.key);
/** 이 사람이 받은 object.added/updated 에 실린 표식 */
const seen = (out: Out[], who: Actor) =>
  out
    .filter((o) => inAudience(o.audience, who) && (o.event.type === "object.updated" || o.event.type === "object.added"))
    .map((o) => ((o.event as { data: GameObject }).data.markers ?? []).map((m) => m.key));

const setup = () => {
  const room = new Room("r", { newId: () => `id-${++n}`, rng: () => 0.5 });
  for (const a of everyone) room.join(a);
  must(room.handle(kp, cmd("session.start", {})));
  const add = (name: string, extra: Partial<Extract<ClientCommand, { type: "object.add" }>["data"]> = {}) => {
    const out = must(room.handle(kp, cmd("object.add", { kind: "token", name, x: 500, y: 400, layer: "object", visibleTo: "all", ...extra })));
    return (out.find((o) => o.event.type === "object.added")!.event as { data: GameObject }).data;
  };
  const mine = add("서하 토큰", { ownerId: "pl1" });
  const theirs = add("도윤 토큰", { ownerId: "pl2" });
  const npc = add("괴물");
  const prop = add("상자", { kind: "prop" });
  return { room, mine, theirs, npc, prop };
};

describe("토큰 상태 표식: 누가 바꿀 수 있나", () => {
  it("GM은 어느 토큰이든 켜고 끌 수 있고, 모두가 보는 표식은 모두에게 간다", () => {
    const { room, npc } = setup();
    const out = must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "stun", on: true })));
    for (const a of everyone) expect(seen(out, a)).toEqual([["stun"]]);
    for (const a of everyone) expect(keys(room, a, npc.id)).toEqual(["stun"]);
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "stun", on: false })));
    for (const a of everyone) expect(keys(room, a, npc.id)).toEqual([]);
  });

  it("주인 PL은 자기 토큰의 비밀이 아닌 표식만 바꾼다", () => {
    const { room, mine, theirs, npc } = setup();
    must(room.handle(pl1, cmd("object.marker", { id: mine.id, key: "focus", on: true })));
    expect(keys(room, pl2, mine.id)).toEqual(["focus"]);
    expect(room.handle(pl1, cmd("object.marker", { id: mine.id, key: "hidden", on: true, secret: true }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(room.handle(pl1, cmd("object.marker", { id: theirs.id, key: "focus", on: true }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(room.handle(pl1, cmd("object.marker", { id: npc.id, key: "focus", on: true }))).toMatchObject({ ok: false, code: "forbidden" });
    must(room.handle(pl1, cmd("object.marker", { id: mine.id, key: "focus", on: false })));
    expect(keys(room, kp, mine.id)).toEqual([]);
  });

  it("관전자는 어떤 표식도 바꿀 수 없다", () => {
    const { room, mine, npc } = setup();
    for (const id of [mine.id, npc.id]) expect(room.handle(spec, cmd("object.marker", { id, key: "stun", on: true }))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("소품에는 붙일 수 없고, 없는 토큰·숨은 토큰은 PL에게 없는 것과 같다", () => {
    const { room, prop, mine } = setup();
    expect(room.handle(kp, cmd("object.marker", { id: prop.id, key: "stun", on: true }))).toMatchObject({ ok: false, code: "bad_message" });
    expect(room.handle(kp, cmd("object.marker", { id: "nope", key: "stun", on: true }))).toMatchObject({ ok: false, code: "not_found" });
    must(room.handle(kp, cmd("object.update", { id: mine.id, layer: "gm" })));
    expect(room.handle(pl1, cmd("object.marker", { id: mine.id, key: "focus", on: true }))).toMatchObject({ ok: false, code: "not_found" });
  });

  it("세션이 없거나 멈춘 동안 PL은 바꿀 수 없고 GM은 준비할 수 있다", () => {
    const { room, mine } = setup();
    must(room.handle(kp, cmd("session.pause", {})));
    expect(room.handle(pl1, cmd("object.marker", { id: mine.id, key: "focus", on: true }))).toMatchObject({ ok: false, code: "paused" });
    must(room.handle(kp, cmd("object.marker", { id: mine.id, key: "help", on: true })));
  });

  it("사용자 지정 표식은 글이 있어야 하고 8자까지다", () => {
    const { room, npc } = setup();
    expect(room.handle(kp, cmd("object.marker", { id: npc.id, key: "custom", on: true }))).toMatchObject({ ok: false, code: "bad_message" });
    expect(room.handle(kp, cmd("object.marker", { id: npc.id, key: "custom", on: true, text: "아홉글자가넘어요오오" }))).toMatchObject({ ok: false, code: "bad_message" });
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "custom", on: true, text: "독이 든 술" })));
    expect(marks(room, pl1, npc.id)).toEqual([{ key: "custom", text: "독이 든 술" }]);
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "custom", on: true, text: "함정" })));
    expect(marks(room, pl1, npc.id)).toEqual([{ key: "custom", text: "함정" }]);
  });
});

describe("토큰 상태 표식: 'GM만 보임'은 서버가 거른다", () => {
  it("비밀 표식은 GM만 받고, PL·다른 PL·관전자에게는 snapshot에도 이벤트에도 없다", () => {
    const { room, mine } = setup();
    const out = [
      ...must(room.handle(kp, cmd("object.marker", { id: mine.id, key: "poison", on: true, secret: true }))),
      ...must(room.handle(kp, cmd("object.marker", { id: mine.id, key: "fear", on: true }))),
    ];
    expect(keys(room, kp, mine.id).sort()).toEqual(["fear", "poison"]);
    for (const a of [pl1, pl2, spec]) {
      expect(keys(room, a, mine.id)).toEqual(["fear"]);
      expect(JSON.stringify(out.filter((o) => inAudience(o.audience, a)).map((o) => o.event))).not.toContain("poison");
      expect(JSON.stringify(room.snapshot(a))).not.toContain("poison");
    }
    // 비밀 표식만 바뀌면 PL·관전자에게는 아무 이벤트도 가지 않고 rev도 오르지 않는다(작업한 사실이 새지 않게)
    const rev = room.snapshot(pl2).objects.find((o) => o.id === mine.id)!.rev;
    const only = must(room.handle(kp, cmd("object.marker", { id: mine.id, key: "bleed", on: true, secret: true })));
    for (const a of [pl1, pl2, spec]) expect(only.filter((o) => inAudience(o.audience, a))).toEqual([]);
    expect(only.filter((o) => inAudience(o.audience, kp))).toHaveLength(1);
    expect(room.snapshot(pl2).objects.find((o) => o.id === mine.id)!.rev).toBe(rev);
    expect(room.snapshot(kp).objects.find((o) => o.id === mine.id)!.rev).toBe(rev);
    // 저장 데이터(GM의 백업)에는 남는다
    expect(room.toData().objects.find((o) => o.id === mine.id)!.markers!.map((m) => m.key).sort()).toEqual(["bleed", "fear", "poison"]);
  });

  it("GM이 몰래 붙인 표식을 주인 PL이 같은 표식으로 켜거나 꺼도 아무 일도 일어나지 않는다(있다는 사실이 새지 않는다)", () => {
    const { room, mine } = setup();
    must(room.handle(kp, cmd("object.marker", { id: mine.id, key: "fear", on: true, secret: true })));
    const rev = room.snapshot(kp).objects.find((o) => o.id === mine.id)!.rev;
    const on = must(room.handle(pl1, cmd("object.marker", { id: mine.id, key: "fear", on: true })));
    const off = must(room.handle(pl1, cmd("object.marker", { id: mine.id, key: "fear", on: false })));
    expect(on).toEqual([]);
    expect(off).toEqual([]);
    expect(room.snapshot(kp).objects.find((o) => o.id === mine.id)!.rev).toBe(rev);
    expect(marks(room, kp, mine.id)).toEqual([{ key: "fear", secret: true }]);
    // 다른 표식을 바꿔도 비밀 표식은 그대로
    must(room.handle(pl1, cmd("object.marker", { id: mine.id, key: "focus", on: true })));
    expect(marks(room, kp, mine.id).map((m) => m.key).sort()).toEqual(["fear", "focus"]);
    expect(keys(room, pl1, mine.id)).toEqual(["focus"]);
  });

  it("비밀을 공개로, 공개를 비밀로 바꾸면 보는 사람에 맞게 나타나거나 사라진다", () => {
    const { room, npc } = setup();
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "hidden", on: true, secret: true })));
    expect(keys(room, pl1, npc.id)).toEqual([]);
    const reveal = must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "hidden", on: true })));
    expect(keys(room, pl1, npc.id)).toEqual(["hidden"]);
    expect(seen(reveal, spec)).toEqual([["hidden"]]);
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "hidden", on: true, secret: true })));
    expect(keys(room, pl1, npc.id)).toEqual([]);
  });

  it("세션 기록에는 공개 표식만 모두에게 남고 비밀 표식은 GM에게만 보인다", () => {
    const { room, npc } = setup();
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "stun", on: true })));
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "poison", on: true, secret: true })));
    const text = (w: Actor) => room.logFor({ userId: w.userId, role: w.role }).entries.map((e) => e.text).join("\n");
    expect(text(pl1)).toContain("기절");
    expect(text(pl1)).not.toContain("중독");
    expect(text(spec)).not.toContain("중독");
    expect(text(kp)).toContain("중독");
  });
});

describe("토큰 상태 표식: 되돌리기·저장·시나리오", () => {
  it("GM의 표식 변경은 Ctrl+Z로 되돌린다(PL의 변경은 GM의 기록에 끼지 않는다)", () => {
    const { room, npc, mine } = setup();
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "stun", on: true })));
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "poison", on: true, secret: true })));
    const out = must(room.handle(kp, cmd("undo.last", {})));
    expect(keys(room, kp, npc.id)).toEqual(["stun"]);
    expect(keys(room, pl1, npc.id)).toEqual(["stun"]);
    expect(out.some((o) => o.event.type === "undo.done" && JSON.stringify(o.event).includes("표식"))).toBe(true);
    must(room.handle(kp, cmd("undo.last", {})));
    expect(keys(room, kp, npc.id)).toEqual([]);
    // 바뀐 것이 없는 호출은 기록을 남기지 않는다
    const label = (o: Out[]) => (o.find((x) => x.event.type === "undo.done")!.event as { data: { label: string } }).data.label;
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "stun", on: false })));
    must(room.handle(pl1, cmd("object.marker", { id: mine.id, key: "focus", on: true })));
    expect(label(must(room.handle(kp, cmd("undo.last", {}))))).toContain("추가");
    expect(keys(room, kp, mine.id)).toEqual(["focus"]);
  });

  it("저장했다 되살려도 표식이 남고, 옛 데이터(표식 없음)와 모양이 깨진 표식도 열린다", () => {
    const { room, npc } = setup();
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "bleed", on: true, secret: true })));
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "custom", on: true, text: "표시" })));
    const data = JSON.parse(JSON.stringify(room.toData()));
    const back = Room.fromData(data);
    expect(marks(back, kp, npc.id)).toEqual([{ key: "bleed", secret: true }, { key: "custom", text: "표시" }]);
    expect(keys(back, pl1, npc.id)).toEqual(["custom"]);
    // 새 버전이 더한 표식(모르는 key)은 그대로 두고 모양이 깨진 것만 버린다
    data.objects.find((o: GameObject) => o.id === npc.id).markers = [{ key: "levitate" }, { key: "Bad Key" }, { key: "stun", secret: "yes" }, 7, { key: "custom" }, { key: "stun" }];
    const m = migrateRoomData(data).objects.find((o) => o.id === npc.id)!;
    expect(m.markers).toEqual([{ key: "levitate" }, { key: "stun" }]);
    const old = JSON.parse(JSON.stringify(room.toData()));
    for (const o of old.objects) delete o.markers;
    expect(marks(Room.fromData(old), kp, npc.id)).toEqual([]);
  });

  it("내보내기에 표식이 담기고, 가져오면 같은 표식이 같은 비밀 여부로 돌아온다", () => {
    const { room, npc, mine } = setup();
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "poison", on: true, secret: true })));
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "custom", on: true, text: "함정" })));
    must(room.handle(kp, cmd("object.marker", { id: mine.id, key: "fear", on: true })));
    for (const format of ["scenario", "backup"] as const) {
      const doc = buildExport(room.toData(), { format, sheets: false, roomName: "룸", exportedAt: "2026-10-19T00:00:00Z" });
      expect(doc.tokens.find((t) => t.name === "괴물")!.markers).toEqual([{ key: "poison", secret: true }, { key: "custom", text: "함정" }]);
      expect(doc.tokens.find((t) => t.name === "상자")!.markers).toBeUndefined();
      const parsed = parseScenario(JSON.parse(JSON.stringify(doc)));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const fresh = new Room("new", { newId: () => `n-${++n}` });
      fresh.join(kp);
      const r = fresh.importScenario("kp1", parsed.doc, { newRoom: true, ownerId: "kp1" });
      expect(r.ok).toBe(true);
      const tok = fresh.snapshot(kp).objects.find((o) => o.name === "괴물")!;
      expect(tok.markers).toEqual([{ key: "poison", secret: true }, { key: "custom", text: "함정" }]);
      expect(fresh.snapshot(kp).objects.find((o) => o.name === "서하 토큰")!.markers).toEqual([{ key: "fear" }]);
    }
  });

  it("장면을 복제하면 표식도 따라가지만 서로 영향을 주지 않는다", () => {
    const { room, npc } = setup();
    must(room.handle(kp, cmd("object.marker", { id: npc.id, key: "stun", on: true })));
    must(room.handle(kp, cmd("scene.duplicate", { id: "main" })));
    const copy = room.snapshot(kp).objects.find((o) => o.name === "괴물" && o.id !== npc.id)!;
    expect(copy.markers).toEqual([{ key: "stun" }]);
    must(room.handle(kp, cmd("object.marker", { id: copy.id, key: "stun", on: false })));
    expect(keys(room, kp, npc.id)).toEqual(["stun"]);
  });
});

describe("시트의 부상 칩과 표식", () => {
  it("연결된 토큰의 HP 요약(vitals)은 표식과 따로 오고 서로 바꾸지 않는다", () => {
    const { room, mine } = setup();
    must(room.handle(pl1, cmd("character.add", { name: "윤서하", age: 30, occupation: "", characteristics: { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 }, skills: [], notes: "", backstory: "", possessions: "", weapons: [] })));
    const sheet = room.snapshot(pl1).characters[0]!;
    must(room.handle(kp, cmd("object.update", { id: mine.id, characterId: sheet.id })));
    must(room.handle(kp, cmd("object.marker", { id: mine.id, key: "dead", on: true })));
    must(room.handle(kp, cmd("damage.apply", { characterId: sheet.id, amount: 50, armor: 0 })));
    const tok = room.snapshot(pl2).objects.find((o) => o.id === mine.id)!;
    expect(tok.vitals?.status).toContain("dead");
    expect(tok.markers).toEqual([{ key: "dead" }]);
  });
});
