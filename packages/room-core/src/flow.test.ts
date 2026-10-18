import { describe, expect, it } from "vitest";
import type { ClientCommand, Flow, Rng } from "@coc-vtt/shared";
import { Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const seo: Actor = { userId: "pl1", name: "윤서하", role: "pl" };

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
const types = (o: Out[]) => o.map((x) => x.event.type);
const flowOf = (o: Out[]): Flow => {
  const ev = [...o].reverse().find((x) => x.event.type === "flow.updated")!.event;
  if (ev.type !== "flow.updated") throw new Error();
  return ev.data.flow;
};

const setup = (rng: Rng = () => 0.5) => {
  const room = new Room("r", { newId: () => `id-${++n}`, rng });
  room.join(kp);
  room.join(seo);
  const sc = must(room.handle(kp, cmd("scene.create", { name: "서재" })))[0]!.event;
  if (sc.type !== "scene.added") throw new Error();
  const h = must(room.handle(kp, cmd("handout.create", { title: "낡은 편지", body: "", visibleTo: "all" })))[0]!.event;
  if (h.type !== "handout.added") throw new Error();
  return { room, study: sc.data.id, letter: h.data.id };
};

const beat = (room: Room, data: Partial<Extract<ClientCommand, { type: "flow.beat.upsert" }>["data"]> & { name: string }) => {
  const f = flowOf(must(room.handle(kp, cmd("flow.beat.upsert", { kind: "progress", memo: "", handoutIds: [], ...data }))));
  return f.beats.find((b) => b.name === data.name)!;
};
const branch = (room: Room, from: string, to: string, condition: Extract<ClientCommand, { type: "flow.branch.upsert" }>["data"]["condition"]) => {
  const f = flowOf(must(room.handle(kp, cmd("flow.branch.upsert", { from, to, label: "분기", condition }))));
  return f.branches[f.branches.length - 1]!;
};
const addChar = (room: Room, who: Actor, san = 50) =>
  must(
    room.handle(
      who,
      cmd("character.add", {
        name: "윤서하",
        age: 27,
        occupation: "기자",
        characteristics: { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 },
        luck: 50,
        san,
        skills: [{ name: "도서관 이용", value: 60, grown: false }],
        notes: "",
        backstory: "",
        possessions: "",
        weapons: [],
      }),
    ),
  );

describe("세션 흐름: 편집", () => {
  it("GM만 편집하고, 참가자 snapshot에는 흐름이 없다", () => {
    const { room } = setup();
    expect(room.handle(seo, cmd("flow.beat.upsert", { name: "x", kind: "progress", memo: "", handoutIds: [] })).ok).toBe(false);
    beat(room, { name: "오프닝", kind: "start" });
    expect(room.snapshot(kp).flow?.beats).toHaveLength(1);
    expect(room.snapshot(seo).flow).toBeNull();
    const out = must(room.handle(kp, cmd("flow.beat.upsert", { name: "y", kind: "progress", memo: "비밀 메모", handoutIds: [] })));
    expect(out.every((o) => o.audience.roles?.length === 1 && o.audience.roles[0] === "kp")).toBe(true);
  });

  it("시작 비트는 하나만 남고, 없는 장면이나 틀린 보상 식은 거절한다", () => {
    const { room } = setup();
    const a = beat(room, { name: "A", kind: "start" });
    beat(room, { name: "B", kind: "start" });
    const f = room.snapshot(kp).flow!;
    expect(f.beats.filter((b) => b.kind === "start").map((b) => b.name)).toEqual(["B"]);
    expect(f.beats.find((b) => b.id === a.id)!.kind).toBe("progress");
    expect(room.handle(kp, cmd("flow.beat.upsert", { name: "C", kind: "progress", memo: "", handoutIds: [], sceneId: "nope" })).ok).toBe(false);
    expect(room.handle(kp, cmd("flow.beat.upsert", { name: "D", kind: "ending", memo: "", handoutIds: [], sanReward: "많이" })).ok).toBe(false);
    expect(room.handle(kp, cmd("flow.beat.upsert", { name: "D", kind: "ending", memo: "", handoutIds: [], sanReward: "1d6+" })).ok).toBe(false);
    expect(room.handle(kp, cmd("flow.beat.upsert", { name: "D", kind: "ending", memo: "", handoutIds: [], sanReward: "1d6+1d4" })).ok).toBe(true);
  });

  it("비트를 고치면 같은 id로 바뀌고, 지우면 이어진 분기도 사라진다", () => {
    const { room } = setup();
    const a = beat(room, { name: "A", kind: "start" });
    const b = beat(room, { name: "B" });
    branch(room, a.id, b.id, { type: "manual" });
    const edited = flowOf(must(room.handle(kp, cmd("flow.beat.upsert", { id: b.id, name: "B2", kind: "progress", memo: "", handoutIds: [] }))));
    expect(edited.beats.map((x) => x.name)).toEqual(["A", "B2"]);
    const removed = flowOf(must(room.handle(kp, cmd("flow.beat.remove", { id: b.id }))));
    expect(removed.beats).toHaveLength(1);
    expect(removed.branches).toHaveLength(0);
    expect(room.handle(kp, cmd("flow.beat.remove", { id: "nope" })).ok).toBe(false);
  });

  it("분기는 두 비트가 있어야 하고 제자리로 되돌아갈 수 없다", () => {
    const { room, letter } = setup();
    const a = beat(room, { name: "A", kind: "start" });
    const b = beat(room, { name: "B" });
    expect(room.handle(kp, cmd("flow.branch.upsert", { from: a.id, to: a.id, label: "x", condition: { type: "manual" } })).ok).toBe(false);
    expect(room.handle(kp, cmd("flow.branch.upsert", { from: a.id, to: "nope", label: "x", condition: { type: "manual" } })).ok).toBe(false);
    expect(room.handle(kp, cmd("flow.branch.upsert", { from: a.id, to: b.id, label: "x", condition: { type: "handout", handoutId: "nope" } })).ok).toBe(false);
    expect(branch(room, a.id, b.id, { type: "handout", handoutId: letter }).label).toBe("분기");
  });

  it("저장했다 복원해도 남는다", () => {
    const { room } = setup();
    const a = beat(room, { name: "A", kind: "start" });
    const b = beat(room, { name: "B" });
    branch(room, a.id, b.id, { type: "manual" });
    const back = Room.fromData(room.toData(), { newId: () => `id-${++n}`, rng: () => 0.5 });
    expect(back.snapshot(kp).flow?.beats.map((x) => x.name)).toEqual(["A", "B"]);
    expect(back.snapshot(kp).flow?.branches).toHaveLength(1);
  });
});

describe("세션 흐름: 진행", () => {
  it("세션을 시작하면 시작 비트의 큐(장면, 핸드아웃)를 실행하고 현재 비트가 된다", () => {
    const { room, study, letter } = setup();
    const a = beat(room, { name: "오프닝", kind: "start", sceneId: study, handoutIds: [letter] });
    const out = must(room.handle(kp, cmd("session.start", {})));
    expect(types(out)).toContain("scene.activated");
    expect(types(out)).toContain("handout.shown");
    expect(flowOf(out).current).toBe(a.id);
    expect(room.snapshot(seo).scenes[0]!.id).toBe(study);
  });

  it("초안 핸드아웃은 큐에서 건너뛴다", () => {
    const { room, letter } = setup();
    must(room.handle(kp, cmd("handout.update", { id: letter, visibleTo: "gm" })));
    beat(room, { name: "오프닝", kind: "start", handoutIds: [letter] });
    const out = must(room.handle(kp, cmd("session.start", {})));
    expect(types(out)).not.toContain("handout.shown");
  });

  it("세션 전에는 옮길 수 없고, 시작 뒤 goto는 큐를 실행한다. 엔딩은 goto로 못 간다", () => {
    const { room, study } = setup();
    const a = beat(room, { name: "A", kind: "start" });
    const b = beat(room, { name: "B", sceneId: study });
    const e = beat(room, { name: "E", kind: "ending" });
    expect(room.handle(kp, cmd("flow.goto", { beatId: b.id })).ok).toBe(false);
    must(room.handle(kp, cmd("session.start", {})));
    expect(room.handle(seo, cmd("flow.goto", { beatId: b.id })).ok).toBe(false);
    const out = must(room.handle(kp, cmd("flow.goto", { beatId: b.id })));
    expect(types(out)).toContain("scene.activated");
    expect(flowOf(out).current).toBe(b.id);
    expect(room.handle(kp, cmd("flow.goto", { beatId: e.id })).ok).toBe(false);
    expect(room.handle(kp, cmd("flow.ending.choose", { beatId: a.id })).ok).toBe(false);
  });

  it("엔딩을 확정하고 종료하면 엔딩 이름과 SAN 보상이 기본값으로 쓰인다", () => {
    const { room } = setup(seq(0.5));
    beat(room, { name: "시작", kind: "start" });
    const e = beat(room, { name: "새벽의 생존자", kind: "ending", sanReward: "1d6" });
    addChar(room, seo, 40);
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(kp, cmd("flow.ending.choose", { beatId: e.id })));
    const out = must(room.handle(kp, cmd("session.end", {})));
    const ended = out.find((o) => o.event.type === "session.ended")!.event;
    if (ended.type !== "session.ended") throw new Error();
    expect(ended.data.ending).toBe("새벽의 생존자");
    expect(ended.data.sanRewards?.[0]).toMatchObject({ before: 40, after: 44 });
  });

  it("GM이 직접 적은 엔딩 이름이 비트보다 우선한다", () => {
    const { room } = setup();
    beat(room, { name: "시작", kind: "start" });
    const e = beat(room, { name: "비트 엔딩", kind: "ending" });
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(kp, cmd("flow.ending.choose", { beatId: e.id })));
    const out = must(room.handle(kp, cmd("session.end", { ending: "직접 적은 이름" })));
    const ended = out.find((o) => o.event.type === "session.ended")!.event;
    if (ended.type !== "session.ended") throw new Error();
    expect(ended.data.ending).toBe("직접 적은 이름");
  });
});

describe("세션 흐름: 분기 제안", () => {
  const started = (rng: Rng) => {
    const ctx = setup(rng);
    const a = beat(ctx.room, { name: "A", kind: "start" });
    const b = beat(ctx.room, { name: "B" });
    return { ...ctx, a, b };
  };
  const rollSkill = (room: Room, who: Actor, id: string, secret = false) =>
    room.handle(who, cmd("roll.request", { secret, skill: { characterId: id, name: "도서관 이용", bonus: 0 } }));
  const charId = (room: Room) => room.snapshot(kp).characters[0]!.id;

  it("공개 판정이 조건 단계 이상이면 제안하되, 스스로 옮기지는 않는다", () => {
    const { room, a, b } = started(seq(0.3, 0.2)); // d100 = 23 → 어려운 성공(60의 절반 30 이하)
    addChar(room, seo);
    branch(room, a.id, b.id, { type: "roll", skill: "도서관 이용", atLeast: "hard" });
    must(room.handle(kp, cmd("session.start", {})));
    const out = must(rollSkill(room, seo, charId(room)));
    const f = flowOf(out);
    expect(f.suggestions).toHaveLength(1);
    expect(f.suggestions[0]!.reason).toContain("어려움 이상");
    expect(f.current).toBe(a.id);
  });

  it("단계가 모자라거나 다른 기능이거나 GM의 비밀 굴림이면 제안하지 않는다", () => {
    const { room, a, b } = started(seq(0.3, 0.2));
    addChar(room, seo);
    branch(room, a.id, b.id, { type: "roll", skill: "도서관 이용", atLeast: "extreme" });
    must(room.handle(kp, cmd("session.start", {})));
    expect(types(must(rollSkill(room, seo, charId(room))))).not.toContain("flow.updated"); // 23은 극단(12 이하)이 아니다
    const s = started(seq(0.3, 0.2));
    addChar(s.room, seo);
    branch(s.room, s.a.id, s.b.id, { type: "roll", skill: "도서관 이용", atLeast: "regular" });
    must(s.room.handle(kp, cmd("session.start", {})));
    expect(types(must(rollSkill(s.room, kp, charId(s.room), true)))).not.toContain("flow.updated");
  });

  it("수치가 기준 이하로 내려가면 제안한다", () => {
    const { room, a, b } = started(() => 0.5);
    addChar(room, seo, 30);
    branch(room, a.id, b.id, { type: "stat", stat: "san", atMost: 20 });
    must(room.handle(kp, cmd("session.start", {})));
    const id = charId(room);
    expect(types(must(room.handle(kp, cmd("sheet.patch", { characterId: id, ops: [{ path: "san", delta: -5 }] }))))).not.toContain("flow.updated");
    const out = must(room.handle(kp, cmd("sheet.patch", { characterId: id, ops: [{ path: "san", delta: -10 }] })));
    expect(flowOf(out).suggestions[0]!.reason).toContain("SAN");
  });

  it("조건에 쓴 핸드아웃을 공개하면 제안한다", () => {
    const { room, a, b, letter } = started(() => 0.5);
    branch(room, a.id, b.id, { type: "handout", handoutId: letter });
    must(room.handle(kp, cmd("session.start", {})));
    const out = must(room.handle(kp, cmd("handout.show", { id: letter })));
    expect(flowOf(out).suggestions[0]!.reason).toContain("낡은 편지");
  });

  it("넘긴 제안은 같은 비트에서 다시 오지 않고, 비트를 옮기면 비워진다", () => {
    const { room, a, b, letter } = started(() => 0.5);
    const br = branch(room, a.id, b.id, { type: "handout", handoutId: letter });
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(kp, cmd("handout.show", { id: letter })));
    expect(flowOf(must(room.handle(kp, cmd("flow.dismiss", { branchId: br.id })))).suggestions).toHaveLength(0);
    expect(types(must(room.handle(kp, cmd("handout.show", { id: letter }))))).not.toContain("flow.updated");
    expect(room.handle(kp, cmd("flow.dismiss", { branchId: br.id })).ok).toBe(false);
    must(room.handle(kp, cmd("flow.goto", { beatId: b.id })));
    expect(room.snapshot(kp).flow!.suggestions).toHaveLength(0);
  });

  it("제안은 GM에게만 간다", () => {
    const { room, a, b, letter } = started(() => 0.5);
    branch(room, a.id, b.id, { type: "handout", handoutId: letter });
    must(room.handle(kp, cmd("session.start", {})));
    const out = must(room.handle(kp, cmd("handout.show", { id: letter })));
    const flowOuts = out.filter((o) => o.event.type === "flow.updated");
    expect(flowOuts.length).toBeGreaterThan(0);
    for (const o of flowOuts) expect(o.audience.roles).toEqual(["kp"]);
  });
});
