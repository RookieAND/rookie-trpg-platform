import { describe, expect, it } from "vitest";
import type { ClientCommand, GameObject } from "@coc-vtt/shared";
import { Room, type Actor, type Out } from "./room";
import { MAX_UNDO } from "./undo";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const pl2: Actor = { userId: "pl2", name: "민준", role: "pl" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const undo = (room: Room, who: Actor = kp) => room.handle(who, cmd("undo.last", {}));
const to = (out: Out[], type: string, user: string) => out.filter((o) => o.event.type === type && (o.audience.users?.includes(user) ?? false));
const names = (room: Room, who: Actor) => room.snapshot(who).objects.map((o) => o.name).sort();

const setup = () => {
  const room = new Room("r", { newId: () => `id-${++n}`, rng: () => 0.5 });
  room.join(kp);
  room.join(pl);
  room.join(pl2);
  must(room.handle(kp, cmd("session.start", {})));
  const add = (name: string, x = 100, y = 100, extra: Partial<Extract<ClientCommand, { type: "object.add" }>["data"]> = {}): GameObject => {
    const out = must(room.handle(kp, cmd("object.add", { kind: "token", name, x, y, layer: "object", visibleTo: "all", ...extra })));
    return (out.find((o) => o.event.type === "object.added")!.event as { data: GameObject }).data;
  };
  const get = (id: string) => room.snapshot(kp).objects.find((o) => o.id === id);
  return { room, add, get };
};

describe("되돌리기", () => {
  it("추가를 되돌리면 삭제 이벤트가 모두에게 간다", () => {
    const { room, add } = setup();
    add("A");
    const out = must(undo(room));
    expect(names(room, kp)).toEqual([]);
    for (const u of ["kp1", "pl1", "pl2"]) expect(to(out, "object.removed", u)).toHaveLength(1);
    expect(to(out, "undo.done", "kp1")).toHaveLength(1);
  });

  it("이동을 되돌린다(rev는 계속 오른다)", () => {
    const { room, add, get } = setup();
    const a = add("A", 100, 100);
    must(room.handle(kp, cmd("object.move", { id: a.id, x: 300, y: 200, rev: 0 })));
    const out = must(undo(room));
    expect(get(a.id)).toMatchObject({ x: 100, y: 100, rev: 2 });
    expect(to(out, "object.updated", "pl1")).toHaveLength(1);
  });

  it("수정(이름·숨김·소유자)을 되돌린다. 숨김을 되돌리면 PL에게 다시 보인다", () => {
    const { room, add, get } = setup();
    const a = add("A");
    must(room.handle(kp, cmd("object.update", { id: a.id, name: "B", ownerId: "pl1" })));
    must(room.handle(kp, cmd("object.update", { id: a.id, visibleTo: "gm" })));
    expect(names(room, pl)).toEqual([]);
    const back1 = must(undo(room));
    expect(to(back1, "object.added", "pl2")).toHaveLength(1);
    expect(names(room, pl2)).toEqual(["B"]);
    // 소유자 변경 되돌림: 소유자였던 pl1은 보이고, 아니면 사라지는 경우도 같은 경로
    must(undo(room));
    expect(get(a.id)).toMatchObject({ name: "A" });
    expect(get(a.id)?.ownerId).toBeUndefined();
  });

  it("삭제를 되돌리면 같은 id·같은 상태로 다시 만들어지고 PL에게는 added가 간다", () => {
    const { room, add, get } = setup();
    const a = add("A", 120, 130, { ownerId: "pl1" });
    must(room.handle(kp, cmd("object.remove", { id: a.id })));
    expect(names(room, pl)).toEqual([]);
    const out = must(undo(room));
    expect(get(a.id)).toMatchObject({ id: a.id, name: "A", x: 120, y: 130, ownerId: "pl1" });
    expect(to(out, "object.added", "pl1")).toHaveLength(1);
  });

  it("GM만 보는 오브젝트의 삭제를 되돌려도 PL에게는 아무것도 가지 않는다", () => {
    const { room, add } = setup();
    const a = add("비밀", 50, 50, { visibleTo: "gm" });
    must(room.handle(kp, cmd("object.remove", { id: a.id })));
    const out = must(undo(room));
    expect(out.filter((o) => (o.event.type as string).startsWith("object.") && o.audience.users?.includes("pl1"))).toHaveLength(0);
  });

  it("안개: 영역 밝히기·지우기·모두 지우기·탐험 기록 지우기를 되돌린다", () => {
    const { room, add } = setup();
    add("멀리", 800, 600);
    must(room.handle(kp, cmd("scene.fog", { id: "main", enabled: true })));
    const zones = () => room.snapshot(kp).scenes.find((s) => s.id === "main")!.fog!.zones;
    const reveal = must(room.handle(kp, cmd("fog.reveal", { sceneId: "main", x: 800, y: 600, r: 80 })));
    expect(to(reveal, "object.added", "pl1")).toHaveLength(1);
    // 밝히기 되돌리기: PL에게서 다시 사라진다
    const u1 = must(undo(room));
    expect(zones()).toHaveLength(0);
    expect(to(u1, "object.removed", "pl1")).toHaveLength(1);
    expect(names(room, pl)).toEqual([]);

    must(room.handle(kp, cmd("fog.reveal", { sceneId: "main", x: 800, y: 600, r: 80 })));
    must(room.handle(kp, cmd("fog.reveal", { sceneId: "main", x: 100, y: 100, r: 50 })));
    must(room.handle(kp, cmd("fog.clear", { sceneId: "main" })));
    expect(zones()).toHaveLength(0);
    const u2 = must(undo(room));
    expect(zones()).toHaveLength(2);
    expect(to(u2, "object.added", "pl1")).toHaveLength(1);
    expect(names(room, pl)).toEqual(["멀리"]);

    const z = zones()[0]!;
    must(room.handle(kp, cmd("fog.remove", { sceneId: "main", zoneId: z.id })));
    must(undo(room));
    expect(zones().map((x) => x.id)).toContain(z.id);

    const before = room.snapshot(kp).scenes.find((s) => s.id === "main")!.fog!.explored;
    expect(before?.length).toBeGreaterThan(0);
    must(room.handle(kp, cmd("fog.forget", { sceneId: "main" })));
    const u3 = must(undo(room));
    expect(room.snapshot(kp).scenes.find((s) => s.id === "main")!.fog!.explored?.length).toBe(before!.length);
    expect(u3.some((o) => o.event.type === "scene.updated" && o.audience.roles?.includes("pl"))).toBe(true);
  });

  it("연속 되돌리기는 최근 것부터 차례로", () => {
    const { room, add, get } = setup();
    const a = add("A", 100, 100);
    must(room.handle(kp, cmd("object.move", { id: a.id, x: 200, y: 200, rev: 0 })));
    must(room.handle(kp, cmd("object.update", { id: a.id, name: "B" })));
    must(room.handle(kp, cmd("object.remove", { id: a.id })));
    must(undo(room));
    expect(get(a.id)).toMatchObject({ name: "B", x: 200 });
    must(undo(room));
    expect(get(a.id)).toMatchObject({ name: "A", x: 200 });
    must(undo(room));
    expect(get(a.id)).toMatchObject({ name: "A", x: 100 });
    must(undo(room));
    expect(get(a.id)).toBeUndefined();
    const r = undo(room);
    expect(r.ok).toBe(false);
  });

  it("대상이 그 뒤 달라졌으면(rev 불일치) 건너뛰지 않고 오류를 내며, 그 기록은 버린다", () => {
    const { room, add, get } = setup();
    const a = add("A", 100, 100);
    must(room.handle(kp, cmd("object.update", { id: a.id, name: "B" })));
    must(room.handle(kp, cmd("object.update", { id: a.id, ownerId: "pl1" })));
    must(room.handle(pl, cmd("object.move", { id: a.id, x: 300, y: 300, rev: 2 })));
    must(room.handle(kp, cmd("object.move", { id: a.id, x: 400, y: 400, rev: 3 })));
    // PL이 아닌 쪽 변화: 마지막 이동 기록 뒤에 다른 수정이 끼어듦
    must(room.handle(pl, cmd("object.move", { id: a.id, x: 450, y: 450, rev: 4 })));
    const r = undo(room);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("stale");
    expect(get(a.id)).toMatchObject({ x: 450 });
    // 다음 호출은 그 다음 기록(이동 전, 소유자 지정)에서 이어가려 해도 rev가 달라 또 거절된다
    expect(undo(room).ok).toBe(false);
  });

  it("장면이 지워져 대상이 사라졌거나 장면이 없으면 거절한다", () => {
    const { room, add } = setup();
    must(room.handle(kp, cmd("scene.create", { name: "둘" })));
    const sid = room.snapshot(kp).scenes.find((s) => s.name === "둘")!.id;
    const a = add("A", 100, 100, { sceneId: sid });
    must(room.handle(kp, cmd("object.remove", { id: a.id })));
    must(room.handle(kp, cmd("scene.remove", { id: sid })));
    const r = undo(room);
    expect(r.ok).toBe(false);
    expect(room.snapshot(kp).objects.find((o) => o.id === a.id)).toBeUndefined();
    const b = add("B");
    must(room.handle(kp, cmd("scene.create", { name: "셋" })));
    must(room.handle(kp, cmd("object.remove", { id: b.id })));
    must(undo(room));
    expect(names(room, kp)).toEqual(["B"]);
  });

  it("GM 외에는 거부하고, 일시정지 중에도 GM은 되돌릴 수 있다", () => {
    const { room, add } = setup();
    add("A");
    const r = undo(room, pl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("forbidden");
    expect(names(room, kp)).toEqual(["A"]);
    must(room.handle(kp, cmd("session.pause", {})));
    must(undo(room));
    expect(names(room, kp)).toEqual([]);
  });

  it("세션 전(IDLE)에도 GM은 되돌릴 수 있다", () => {
    const room = new Room("r2", { newId: () => `id-${++n}` });
    room.join(kp);
    must(room.handle(kp, cmd("object.add", { kind: "token", name: "A", x: 1, y: 1, layer: "object", visibleTo: "all" })));
    must(undo(room));
    expect(room.snapshot(kp).objects).toHaveLength(0);
  });

  it(`기록은 ${MAX_UNDO}개까지만 남는다`, () => {
    const { room, add } = setup();
    for (let i = 0; i < MAX_UNDO + 5; i++) add(`T${i}`, 30 + i, 30);
    for (let i = 0; i < MAX_UNDO; i++) must(undo(room));
    expect(room.snapshot(kp).objects).toHaveLength(5);
    expect(undo(room).ok).toBe(false);
  });

  it("되돌리기 자체는 기록하지 않고, 기록은 저장 데이터에 들어가지 않는다", () => {
    const { room, add } = setup();
    add("A");
    must(undo(room));
    expect(undo(room).ok).toBe(false);
    expect(JSON.stringify(room.toData())).not.toContain("undo");
  });
});
