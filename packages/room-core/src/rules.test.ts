import { describe, expect, it } from "vitest";
import type { Character, ClientCommand, Rng, RollLogEntry, ServerEvent } from "@coc-vtt/shared";
import { inAudience, Room, type Actor, type Out } from "./room";

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
/** d10 한 칸(0~9)을 고르는 값 */
const d10 = (k: number) => (k + 0.05) / 10;
/** d100 결과 total(1~100)을 만드는 두 번의 난수 (일의 자리, 십의 자리) */
const pct = (total: number): number[] => {
  const t = total === 100 ? 0 : Math.floor(total / 10);
  const u = total === 100 ? 0 : total % 10;
  return [d10(u), d10(t)];
};
const face = (k: number, sides: number) => (k - 0.5) / sides;

/** 서버 난수를 테스트가 바꿔 끼울 수 있게 감싼다. */
const makeRng = () => {
  let q: number[] = [];
  const rng: Rng = () => (q.length ? q.shift()! : 0.5);
  return { rng, next: (...v: number[]) => (q = [...v]) };
};

interface World {
  room: Room;
  rng: ReturnType<typeof makeRng>;
  seoC: Character; // 최대 HP 12, DEX 60
  hanC: Character; // 최대 HP 10
  npc: Character; // GM의 NPC, 최대 HP 12
}

const sheet = (name: string, con: number, siz: number, over: Record<string, unknown> = {}) =>
  ({
    name,
    age: 27,
    occupation: "",
    characteristics: { STR: 50, CON: con, SIZ: siz, DEX: 60, APP: 50, INT: 70, POW: 60, EDU: 70 },
    luck: 50,
    skills: [
      { name: "관찰력", value: 60, grown: false },
      { name: "도서관 이용", value: 40, grown: false },
    ],
    weapons: [{ name: "칼", skill: "도서관 이용", damage: "1d10+2" }],
    ...over,
  }) as Extract<ClientCommand, { type: "character.add" }>["data"];

const added = (outs: Out[]): Character => {
  const ev = outs.find((o) => o.event.type === "character.added")!.event as Extract<ServerEvent, { type: "character.added" }>;
  return ev.data;
};

const world = (): World => {
  const rng = makeRng();
  const room = new Room("r", { newId: () => `id-${++n}`, rng: rng.rng, rollsPerSecond: 1000 });
  for (const a of [kp, seo, han, spec]) room.join(a);
  room.handle(kp, cmd("session.start", {}));
  const seoC = added(must(room.handle(seo, cmd("character.add", sheet("윤서하", 60, 60)))));
  const hanC = added(must(room.handle(han, cmd("character.add", sheet("한도윤", 50, 50)))));
  const npc = added(must(room.handle(kp, cmd("character.add", sheet("광신도", 60, 60, { ownerId: kp.userId, skills: [{ name: "관찰력", value: 50, grown: false }, { name: "STR", value: 55, grown: false }] })))));
  return { room, rng, seoC, hanC, npc };
};

const cur = (w: World, id: string): Character => w.room.snapshot(kp).characters.find((c) => c.id === id)!;
const events = <T extends Exclude<ServerEvent["type"], "snapshot">>(outs: Out[], type: T): Array<Extract<Out["event"], { type: T }>> =>
  outs.map((o) => o.event).filter((e) => e.type === type) as Array<Extract<Out["event"], { type: T }>>;
const lastRoll = (outs: Out[]): RollLogEntry => events(outs, "roll.result")[0]!.data;
const apply = (w: World, characterId: string, d: { amount?: number; rollId?: string; armor?: number }, who: Actor = kp) =>
  w.room.handle(who, cmd("damage.apply", { characterId, armor: d.armor ?? 0, ...(d.amount !== undefined ? { amount: d.amount } : {}), ...(d.rollId ? { rollId: d.rollId } : {}) }));

describe("피해 적용 (damage.apply)", () => {
  it("무기 피해 굴림 결과를 대상 시트에 적용한다 (1d10+2 = 눈 6 → 8, 최대 12의 절반 이상이라 중상)", () => {
    const w = world();
    w.rng.next(face(6, 10));
    const roll = lastRoll(must(w.room.handle(kp, cmd("damage.roll", { characterId: w.npc.id, weaponIndex: 0 }))));
    expect(roll.damage).toBe(true);
    expect(roll.outcome).toMatchObject({ kind: "dice", total: 8 });
    const outs = must(apply(w, w.seoC.id, { rollId: roll.id }));
    expect(cur(w, w.seoC.id)).toMatchObject({ hp: 4, conditions: ["majorWound"] });
    expect(events(outs, "damage.applied")[0]!.data).toMatchObject({ rollId: roll.id, characterId: w.seoC.id, amount: 8, armor: 0, dealt: 8, hpBefore: 12, hp: 4, kind: "major", newMajor: true, conRoll: true });
  });

  it("방어구를 뺀 피해만 들어간다 (피해 8, 방어구 3 → 5, 최대 12는 중상 아님)", () => {
    const w = world();
    const outs = must(apply(w, w.seoC.id, { amount: 8, armor: 3 }));
    expect(cur(w, w.seoC.id)).toMatchObject({ hp: 7 });
    expect(cur(w, w.seoC.id).conditions).toBeUndefined();
    expect(events(outs, "damage.applied")[0]!.data).toMatchObject({ amount: 8, armor: 3, dealt: 5, kind: "wounded", conRoll: false });
  });

  it("방어구가 피해 이상이면 HP가 그대로고 시트 변경도 없다", () => {
    const w = world();
    const outs = must(apply(w, w.seoC.id, { amount: 3, armor: 5 }));
    expect(cur(w, w.seoC.id)).toMatchObject({ hp: 12, rev: 0 });
    expect(events(outs, "character.updated")).toHaveLength(0);
    expect(events(outs, "damage.applied")[0]!.data).toMatchObject({ dealt: 0, kind: "none" });
  });

  it("중상 경계: 5는 아니고 6은 중상이며 건강 판정(CON)을 알린다", () => {
    const w = world();
    expect(events(must(apply(w, w.seoC.id, { amount: 5 })), "damage.applied")[0]!.data).toMatchObject({ kind: "wounded", conRoll: false, newMajor: false });
    const w2 = world();
    expect(events(must(apply(w2, w2.seoC.id, { amount: 6 })), "damage.applied")[0]!.data).toMatchObject({ kind: "major", conRoll: true, newMajor: true });
    expect(cur(w2, w2.seoC.id).conditions).toEqual(["majorWound"]);
  });

  it("HP가 0이 되면 중상이 없을 때 기절, 있을 때 빈사", () => {
    const w = world();
    must(apply(w, w.seoC.id, { amount: 5 }));
    must(apply(w, w.seoC.id, { amount: 5 })); // 합계 10, HP 2
    must(apply(w, w.seoC.id, { amount: 2 })); // HP 0, 중상 아님
    expect(cur(w, w.seoC.id)).toMatchObject({ hp: 0, conditions: ["unconscious"] });

    const w2 = world();
    must(apply(w2, w2.seoC.id, { amount: 6 })); // 중상, HP 6
    const outs = must(apply(w2, w2.seoC.id, { amount: 6 })); // HP 0 → 빈사
    expect(cur(w2, w2.seoC.id)).toMatchObject({ hp: 0, conditions: ["majorWound", "dying"], dyingRounds: 0 });
    expect(events(outs, "damage.applied")[0]!.data.kind).toBe("dying");
  });

  it("즉사: 한 번의 피해가 최대 HP 이상이면 사망", () => {
    const w = world();
    const outs = must(apply(w, w.seoC.id, { amount: 12 }));
    expect(cur(w, w.seoC.id)).toMatchObject({ hp: 0, conditions: ["dead"] });
    expect(events(outs, "damage.applied")[0]!.data).toMatchObject({ kind: "dead", massive: true });
    const w2 = world();
    must(apply(w2, w2.seoC.id, { amount: 11 }));
    expect(cur(w2, w2.seoC.id)).toMatchObject({ hp: 1, conditions: ["majorWound"] });
  });

  it("사망한 캐릭터에게는 적용되지 않는다", () => {
    const w = world();
    must(apply(w, w.seoC.id, { amount: 12 }));
    expect(apply(w, w.seoC.id, { amount: 1 })).toMatchObject({ ok: false, code: "bad_sheet" });
  });

  it("같은 피해 굴림을 같은 캐릭터에게 두 번 적용할 수 없지만 다른 캐릭터에게는 된다", () => {
    const w = world();
    w.rng.next(face(1, 10));
    const roll = lastRoll(must(w.room.handle(kp, cmd("damage.roll", { characterId: w.npc.id, weaponIndex: 0 }))));
    must(apply(w, w.seoC.id, { rollId: roll.id }));
    expect(apply(w, w.seoC.id, { rollId: roll.id })).toMatchObject({ ok: false, code: "bad_roll" });
    must(apply(w, w.hanC.id, { rollId: roll.id }));
    expect(w.room.snapshot(kp).damageApplied).toEqual({ [roll.id]: [w.seoC.id, w.hanC.id] });
    expect(w.room.snapshot(seo).damageApplied).toEqual({});
  });

  it("적용 기록은 저장·복원해도 남아서 재시작 뒤에도 중복 적용을 막는다", () => {
    const w = world();
    w.rng.next(face(1, 10));
    const roll = lastRoll(must(w.room.handle(kp, cmd("damage.roll", { characterId: w.npc.id, weaponIndex: 0 }))));
    must(apply(w, w.seoC.id, { rollId: roll.id }));
    const copy = Room.fromData(JSON.parse(JSON.stringify(w.room.toData())), { newId: () => `id-${++n}` });
    copy.join(kp);
    expect(copy.handle(kp, cmd("damage.apply", { characterId: w.seoC.id, rollId: roll.id, armor: 0 }))).toMatchObject({ ok: false, code: "bad_roll" });
  });

  it("주사위 굴림이 아니거나 없는 굴림은 쓸 수 없다", () => {
    const w = world();
    const cc = lastRoll(must(w.room.handle(kp, cmd("roll.request", { secret: false, expr: "CC<=50" }))));
    expect(apply(w, w.seoC.id, { rollId: cc.id })).toMatchObject({ ok: false, code: "not_found" });
    expect(apply(w, w.seoC.id, { rollId: "nope" })).toMatchObject({ ok: false, code: "not_found" });
    expect(apply(w, "nope", { amount: 1 })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("GM만 적용한다: PL(자기 시트 포함)과 관전자는 거절", () => {
    const w = world();
    expect(apply(w, w.seoC.id, { amount: 3 }, seo)).toMatchObject({ ok: false, code: "forbidden" });
    expect(apply(w, w.hanC.id, { amount: 3 }, seo)).toMatchObject({ ok: false, code: "forbidden" });
    expect(apply(w, w.seoC.id, { amount: 3 }, spec)).toMatchObject({ ok: false, code: "forbidden" });
    expect(cur(w, w.seoC.id).hp).toBe(12);
  });

  it("결과는 시트 주인과 GM만 받는다", () => {
    const w = world();
    const outs = must(apply(w, w.seoC.id, { amount: 3 }));
    const dmg = outs.filter((o) => o.event.type === "damage.applied" || o.event.type === "character.updated");
    expect(dmg.length).toBe(2);
    for (const o of dmg) {
      expect(inAudience(o.audience, kp)).toBe(true);
      expect(inAudience(o.audience, seo)).toBe(true);
      expect(inAudience(o.audience, han)).toBe(false);
      expect(inAudience(o.audience, spec)).toBe(false);
    }
  });

  it("일시정지 중에는 GM도 적용하지 못한다", () => {
    const w = world();
    w.room.handle(kp, cmd("session.pause", {}));
    expect(apply(w, w.seoC.id, { amount: 3 })).toMatchObject({ ok: false, code: "paused" });
  });

  it("rollId와 amount를 함께 주거나 둘 다 빼면 스키마가 거절한다", async () => {
    const { clientCommandSchema } = await import("@coc-vtt/shared");
    expect(clientCommandSchema.safeParse(cmd("damage.apply", { characterId: "a", armor: 0 })).success).toBe(false);
    expect(clientCommandSchema.safeParse({ type: "damage.apply", data: { characterId: "a", rollId: "r", amount: 3 } }).success).toBe(false);
    expect(clientCommandSchema.safeParse({ type: "damage.apply", data: { characterId: "a", amount: 3 } }).success).toBe(true);
    expect(clientCommandSchema.safeParse({ type: "damage.apply", data: { characterId: "a", amount: -1 } }).success).toBe(false);
  });
});

describe("회복 (hp.heal)", () => {
  const heal = (w: World, characterId: string, kind: "firstAid" | "natural" | "manual", amount?: number, who: Actor = kp) =>
    w.room.handle(who, cmd("hp.heal", { characterId, kind, ...(amount !== undefined ? { amount } : {}) }));

  it("응급처치는 빈사를 풀고 HP 1이 된다, 중상은 남는다", () => {
    const w = world();
    must(apply(w, w.seoC.id, { amount: 6 }));
    must(apply(w, w.seoC.id, { amount: 6 }));
    expect(cur(w, w.seoC.id).conditions).toEqual(["majorWound", "dying"]);
    must(heal(w, w.seoC.id, "firstAid"));
    expect(cur(w, w.seoC.id)).toMatchObject({ hp: 1, conditions: ["majorWound"] });
    expect(cur(w, w.seoC.id).dyingRounds).toBeUndefined();
  });

  it("중상은 HP가 최대의 절반(12 → 6) 이상이 되면 풀린다", () => {
    const w = world();
    must(apply(w, w.seoC.id, { amount: 7 })); // HP 5, 중상
    must(heal(w, w.seoC.id, "natural", 1)); // HP 6
    expect(cur(w, w.seoC.id)).toMatchObject({ hp: 6 });
    expect(cur(w, w.seoC.id).conditions).toBeUndefined();
    const w2 = world();
    must(apply(w2, w2.seoC.id, { amount: 8 })); // HP 4
    must(heal(w2, w2.seoC.id, "natural", 1)); // HP 5
    expect(cur(w2, w2.seoC.id).conditions).toEqual(["majorWound"]);
  });

  it("최대 HP를 넘지 않고, 이미 가득이면 아무 일도 없다", () => {
    const w = world();
    must(apply(w, w.seoC.id, { amount: 2 }));
    must(heal(w, w.seoC.id, "manual", 50));
    expect(cur(w, w.seoC.id).hp).toBe(12);
    const rev = cur(w, w.seoC.id).rev;
    expect(must(heal(w, w.seoC.id, "firstAid"))).toHaveLength(0);
    expect(cur(w, w.seoC.id).rev).toBe(rev);
  });

  it("사망한 캐릭터는 회복할 수 없다", () => {
    const w = world();
    must(apply(w, w.seoC.id, { amount: 12 }));
    expect(heal(w, w.seoC.id, "firstAid")).toMatchObject({ ok: false, code: "bad_sheet" });
  });

  it("GM만 회복을 적용한다", () => {
    const w = world();
    must(apply(w, w.seoC.id, { amount: 3 }));
    expect(heal(w, w.seoC.id, "firstAid", undefined, seo)).toMatchObject({ ok: false, code: "forbidden" });
    expect(cur(w, w.seoC.id).hp).toBe(9);
  });

  it("직접 회복은 회복량이 필요하다 (스키마)", async () => {
    const { clientCommandSchema } = await import("@coc-vtt/shared");
    expect(clientCommandSchema.safeParse({ type: "hp.heal", data: { characterId: "a", kind: "manual" } }).success).toBe(false);
    expect(clientCommandSchema.safeParse({ type: "hp.heal", data: { characterId: "a", kind: "firstAid" } }).success).toBe(true);
  });
});

describe("시트 HP 직접 수정과 서버 권한 (H4 결정)", () => {
  const patch = (w: World, who: Actor, characterId: string, ops: Extract<ClientCommand, { type: "sheet.patch" }>["data"]["ops"]) => w.room.handle(who, cmd("sheet.patch", { characterId, ops }));

  it("PL은 자기 HP/MP/SAN/행운을 직접 고칠 수 있다 (문서화한 신뢰 기반 동작)", () => {
    const w = world();
    must(patch(w, seo, w.seoC.id, [{ path: "hp", delta: -2 }, { path: "luck", value: 30 }]));
    expect(cur(w, w.seoC.id)).toMatchObject({ hp: 10, luck: 30 });
  });

  it("HP를 직접 줄여도 중상·기절·빈사는 서버가 정한다 (한 번에 6 감소 → 중상)", () => {
    const w = world();
    must(patch(w, seo, w.seoC.id, [{ path: "hp", delta: -6 }]));
    expect(cur(w, w.seoC.id)).toMatchObject({ hp: 6, conditions: ["majorWound"] });
    must(patch(w, seo, w.seoC.id, [{ path: "hp", value: 0 }]));
    expect(cur(w, w.seoC.id)).toMatchObject({ hp: 0, conditions: ["majorWound", "dying"], dyingRounds: 0 });
    must(patch(w, seo, w.seoC.id, [{ path: "hp", value: 7 }]));
    expect(cur(w, w.seoC.id).conditions).toBeUndefined(); // HP 7 ≥ 6: 빈사·중상 모두 풀림
  });

  it("직접 최대치에서 0으로 줄여도 즉사로 보지 않는다 (피해 적용만 즉사 판정)", () => {
    const w = world();
    must(patch(w, seo, w.seoC.id, [{ path: "hp", value: 0 }]));
    expect(cur(w, w.seoC.id).conditions).toEqual(["majorWound", "dying"]);
  });

  it("사망한 시트의 HP는 직접 고칠 수 없다. GM이 사망 표시를 풀면 고칠 수 있다", () => {
    const w = world();
    must(apply(w, w.seoC.id, { amount: 12 }));
    expect(patch(w, seo, w.seoC.id, [{ path: "hp", delta: 5 }])).toMatchObject({ ok: false, code: "bad_sheet" });
    expect(patch(w, kp, w.seoC.id, [{ path: "hp", delta: 5 }])).toMatchObject({ ok: false, code: "bad_sheet" });
    must(patch(w, kp, w.seoC.id, [{ path: "condition", name: "dead", on: false }]));
    must(patch(w, kp, w.seoC.id, [{ path: "hp", value: 3 }]));
    expect(cur(w, w.seoC.id)).toMatchObject({ hp: 3 });
  });

  it("GM이 사망·빈사를 켜면 다른 표시가 정리된다", () => {
    const w = world();
    must(patch(w, kp, w.seoC.id, [{ path: "condition", name: "unconscious", on: true }, { path: "condition", name: "majorWound", on: true }]));
    must(patch(w, kp, w.seoC.id, [{ path: "condition", name: "dying", on: true }]));
    expect(cur(w, w.seoC.id)).toMatchObject({ conditions: ["majorWound", "dying"], dyingRounds: 0 });
    must(patch(w, kp, w.seoC.id, [{ path: "condition", name: "dead", on: true }]));
    expect(cur(w, w.seoC.id).conditions).toEqual(["dead"]);
    expect(cur(w, w.seoC.id).dyingRounds).toBeUndefined();
  });

  it("PL이 기능 값·무기·상태를 직접 바꾸려 하면 모두 거절되고 아무것도 바뀌지 않는다", () => {
    const w = world();
    const before = JSON.stringify(cur(w, w.seoC.id));
    for (const op of [
      { path: "skill", name: "관찰력", value: 99 },
      { path: "skill", name: "관찰력", delta: 30 },
      { path: "weapons", value: [{ name: "대포", skill: "관찰력", damage: "9d9" }] },
      { path: "condition", name: "dying", on: true },
      { path: "madness", value: "none" },
    ] as const) {
      expect(patch(w, seo, w.seoC.id, [op as never]), JSON.stringify(op)).toMatchObject({ ok: false, code: "forbidden" });
    }
    expect(JSON.stringify(cur(w, w.seoC.id))).toBe(before);
  });

  it("남의 시트는 GM이 아니면 존재도 모른다", () => {
    const w = world();
    expect(patch(w, seo, w.hanC.id, [{ path: "hp", delta: -1 }])).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("전투 순서의 상태 칩과 빈사 라운드", () => {
  const start = (w: World) => must(w.room.handle(kp, cmd("initiative.start", {})));
  const entry = (v: Actor, name: string) => w0.room.snapshot(v).initiative!.entries.find((e) => e.name === name);
  let w0: World;

  it("시트가 있는 칸에 상태가 붙고 피해를 적용하면 모두에게 바로 갱신된다", () => {
    w0 = world();
    start(w0);
    expect(entry(kp, "윤서하")?.status).toBeUndefined();
    const outs = must(apply(w0, w0.seoC.id, { amount: 3 }));
    const upd = events(outs, "initiative.updated");
    expect(upd.length).toBeGreaterThan(0);
    expect(entry(han, "윤서하")?.status).toEqual(["injured"]);
    expect(entry(spec, "윤서하")?.status).toEqual(["injured"]);
    must(apply(w0, w0.seoC.id, { amount: 6 }));
    expect(entry(han, "윤서하")?.status).toEqual(["majorWound"]);
    must(apply(w0, w0.seoC.id, { amount: 3 }));
    expect(entry(seo, "윤서하")?.status).toEqual(["dying", "majorWound"]);
    must(apply(w0, w0.hanC.id, { amount: 10 }));
    expect(entry(kp, "한도윤")?.status).toEqual(["dead"]);
  });

  it("직접 HP를 고쳐도 전투 순서 칸이 바뀐다", () => {
    w0 = world();
    start(w0);
    const outs = must(w0.room.handle(seo, cmd("sheet.patch", { characterId: w0.seoC.id, ops: [{ path: "hp", delta: -7 }] })));
    expect(events(outs, "initiative.updated").length).toBeGreaterThan(0);
    expect(entry(han, "윤서하")?.status).toEqual(["majorWound"]);
  });

  it("GM의 NPC 시트는 PL에게 알 수 없는 상대로만 보이고 상태도 새지 않는다", () => {
    w0 = world();
    start(w0);
    must(apply(w0, w0.npc.id, { amount: 3 }));
    expect(entry(kp, "광신도")?.status).toEqual(["injured"]);
    const hidden = w0.room.snapshot(seo).initiative!.entries.find((e) => e.hidden)!;
    expect(hidden).toEqual({ id: hidden.id, name: "알 수 없는 상대", dex: 0, hidden: true });
    const outs = must(apply(w0, w0.npc.id, { amount: 12 }));
    const seen = outs.filter((o) => o.event.type === "initiative.updated" && inAudience(o.audience, seo));
    expect(seen.length).toBeGreaterThan(0);
    for (const o of seen) expect(JSON.stringify(o.event)).not.toContain("dead");
  });

  it("라운드가 오를 때마다 빈사 캐릭터의 라운드 세기가 오르고, 회복하면 지워진다", () => {
    w0 = world();
    start(w0);
    must(apply(w0, w0.seoC.id, { amount: 6 }));
    must(apply(w0, w0.seoC.id, { amount: 6 }));
    expect(cur(w0, w0.seoC.id).dyingRounds).toBe(0);
    const count = w0.room.snapshot(kp).initiative!.entries.length;
    for (let i = 0; i < count; i++) must(w0.room.handle(kp, cmd("initiative.next", {}))); // 한 바퀴 → 2라운드
    expect(w0.room.snapshot(kp).initiative!.round).toBe(2);
    expect(cur(w0, w0.seoC.id).dyingRounds).toBe(1);
    for (let i = 0; i < count; i++) must(w0.room.handle(kp, cmd("initiative.next", {})));
    expect(cur(w0, w0.seoC.id).dyingRounds).toBe(2);
    must(w0.room.handle(kp, cmd("hp.heal", { characterId: w0.seoC.id, kind: "firstAid" })));
    expect(cur(w0, w0.seoC.id).dyingRounds).toBeUndefined();
    for (let i = 0; i < count; i++) must(w0.room.handle(kp, cmd("initiative.next", {})));
    expect(cur(w0, w0.seoC.id).dyingRounds).toBeUndefined();
  });

  it("빈사가 아닌 캐릭터의 시트는 라운드가 올라도 바뀌지 않는다", () => {
    w0 = world();
    start(w0);
    const rev = cur(w0, w0.hanC.id).rev;
    const count = w0.room.snapshot(kp).initiative!.entries.length;
    for (let i = 0; i < count; i++) must(w0.room.handle(kp, cmd("initiative.next", {})));
    expect(cur(w0, w0.hanC.id).rev).toBe(rev);
  });
});

describe("대항 판정 (roll.opposed)", () => {
  const opposed = (w: World, who: Actor, a: [Character, string], b: [Character, string], secret = false) =>
    w.room.handle(who, cmd("roll.opposed", { a: { characterId: a[0].id, name: a[1] }, b: { characterId: b[0].id, name: b[1] }, secret }));
  const outcomeOf = (outs: Out[]) => {
    const o = lastRoll(outs).outcome;
    if (o.kind !== "opposed") throw new Error("not opposed");
    return o;
  };

  it("GM이 NPC와 PL을 맞붙인다: 높은 성공 단계가 이긴다 (서하 관찰력 60에서 25 = 보통, 광신도 50에서 20 = 어려움 → 광신도 승)", () => {
    const w = world();
    // 서하(a)는 25(60 이하 → 보통은 31~60, 25는 어려움 ≤30)이므로 값을 바꿔 확실히: a=45(보통), b=20(어려움)
    w.rng.next(...pct(45), ...pct(20));
    const outs = must(opposed(w, kp, [w.seoC, "관찰력"], [w.npc, "관찰력"]));
    const o = outcomeOf(outs);
    expect(o).toMatchObject({ winner: "b", reason: "level", statusQuo: false });
    expect(o.a).toMatchObject({ character: "윤서하", name: "관찰력", target: 60, level: "regular" });
    expect(o.a.percent.total).toBe(45);
    expect(o.b).toMatchObject({ character: "광신도", target: 50, level: "hard" });
    expect(o.summary).toBe("광신도가 이겼어요 (어려운 성공 대 성공).");
  });

  it("두 굴림이 로그 한 줄이다: 한 항목, 비밀이 아니면 모두에게 간다", () => {
    const w = world();
    const before = w.room.snapshot(kp).rolls.length;
    const outs = must(opposed(w, kp, [w.seoC, "관찰력"], [w.npc, "관찰력"]));
    expect(events(outs, "roll.result")).toHaveLength(1);
    expect(w.room.snapshot(kp).rolls.length).toBe(before + 1);
    const entry = lastRoll(outs);
    expect(entry.label).toBe("윤서하 · 관찰력 대 광신도 · 관찰력");
    expect(entry.check).toBeUndefined();
    expect(outs.every((o) => inAudience(o.audience, spec))).toBe(true);
  });

  it("한쪽만 성공하면 성공한 쪽이 이긴다", () => {
    const w = world();
    w.rng.next(...pct(70), ...pct(50)); // a 70 > 60 실패, b 50 ≤ 50 성공
    expect(outcomeOf(must(opposed(w, kp, [w.seoC, "관찰력"], [w.npc, "관찰력"])))).toMatchObject({ winner: "b", reason: "level" });
  });

  it("둘 다 실패하면 아무도 이기지 못하고 방어하는 쪽(b)이 유리하다고 표시한다", () => {
    const w = world();
    w.rng.next(...pct(80), ...pct(100)); // 실패, 대실패
    const o = outcomeOf(must(opposed(w, kp, [w.seoC, "관찰력"], [w.npc, "관찰력"])));
    expect(o).toMatchObject({ winner: "none", reason: "bothFail", statusQuo: true });
    expect(o.summary).toContain("광신도가 유리해요");
  });

  it("같은 단계면 기능 값이 높은 쪽이 이긴다 (둘 다 보통 성공: 60 대 50 → 서하)", () => {
    const w = world();
    w.rng.next(...pct(40), ...pct(40));
    expect(outcomeOf(must(opposed(w, kp, [w.seoC, "관찰력"], [w.npc, "관찰력"])))).toMatchObject({ winner: "a", reason: "value" });
    w.rng.next(...pct(40), ...pct(40));
    expect(outcomeOf(must(opposed(w, kp, [w.npc, "관찰력"], [w.seoC, "관찰력"])))).toMatchObject({ winner: "b", reason: "value" });
  });

  it("값까지 같으면 비김(다시 굴림)", () => {
    const w = world();
    w.rng.next(...pct(40), ...pct(40));
    const o = outcomeOf(must(opposed(w, kp, [w.seoC, "도서관 이용"], [w.hanC, "도서관 이용"])));
    expect(o).toMatchObject({ winner: "tie", reason: "tie" });
    expect(o.summary).toContain("다시 굴려요");
  });

  it("양쪽 모두 특성치로 굴려 단계가 같으면 값과 상관없이 비김", () => {
    const w = world();
    w.rng.next(...pct(40), ...pct(40)); // STR 50: 40은 보통, 광신도 STR은 기능 55라 기능 취급 → 특성치 아님
    expect(outcomeOf(must(opposed(w, kp, [w.seoC, "STR"], [w.hanC, "STR"])))).toMatchObject({ winner: "tie" });
    w.rng.next(...pct(40), ...pct(40));
    expect(outcomeOf(must(opposed(w, kp, [w.seoC, "STR"], [w.npc, "STR"])))).toMatchObject({ winner: "b", reason: "value" }); // NPC는 기능 STR 55 > 50
  });

  it("보너스·페널티 주사위는 없다: 십의 자리 주사위를 하나만 굴린다", () => {
    const w = world();
    const o = outcomeOf(must(opposed(w, kp, [w.seoC, "관찰력"], [w.npc, "관찰력"])));
    expect(o.a.percent.tens).toHaveLength(1);
    expect(o.b.percent.tens).toHaveLength(1);
    expect(o.a.percent.bonus).toBe(0);
  });

  it("푸시와 행운은 쓸 수 없다", () => {
    const w = world();
    w.rng.next(...pct(90), ...pct(90));
    const entry = lastRoll(must(opposed(w, kp, [w.seoC, "관찰력"], [w.npc, "관찰력"])));
    expect(w.room.handle(kp, cmd("roll.push", { rollId: entry.id }))).toMatchObject({ ok: false });
    expect(w.room.handle(seo, cmd("luck.spend", { rollId: entry.id }))).toMatchObject({ ok: false });
  });

  it("PL은 자기 캐릭터와 다른 PL 캐릭터로 시작할 수 있다", () => {
    const w = world();
    expect(opposed(w, seo, [w.seoC, "관찰력"], [w.hanC, "관찰력"]).ok).toBe(true);
  });

  it("PL은 상대 PL의 캐릭터 id를 몰라도 userId로 가리킬 수 있다 (GM의 NPC는 안 된다)", () => {
    const w = world();
    const r = w.room.handle(seo, cmd("roll.opposed", { a: { characterId: w.seoC.id, name: "관찰력" }, b: { userId: han.userId, name: "관찰력" }, secret: false }));
    expect(r.ok).toBe(true);
    expect(lastRoll(must(r)).label).toBe("윤서하 · 관찰력 대 한도윤 · 관찰력");
    expect(w.room.handle(seo, cmd("roll.opposed", { a: { characterId: w.seoC.id, name: "관찰력" }, b: { userId: kp.userId, name: "관찰력" }, secret: false }))).toMatchObject({ ok: false, code: "not_found" });
    expect(w.room.handle(seo, cmd("roll.opposed", { a: { characterId: w.seoC.id, name: "관찰력" }, b: { userId: "ghost", name: "관찰력" }, secret: false }))).toMatchObject({ ok: false, code: "not_found" });
  });

  it("상대를 characterId와 userId로 함께 주거나 빼면 스키마가 거절한다", async () => {
    const { clientCommandSchema } = await import("@coc-vtt/shared");
    const base = { a: { characterId: "x", name: "관찰력" } };
    expect(clientCommandSchema.safeParse({ type: "roll.opposed", data: { ...base, b: { name: "관찰력" } } }).success).toBe(false);
    expect(clientCommandSchema.safeParse({ type: "roll.opposed", data: { ...base, b: { characterId: "y", userId: "u", name: "관찰력" } } }).success).toBe(false);
    expect(clientCommandSchema.safeParse({ type: "roll.opposed", data: { ...base, b: { userId: "u", name: "관찰력" } } }).success).toBe(true);
  });

  it("PL은 남의 캐릭터를 내 쪽(a)으로 쓸 수 없고, GM의 NPC를 상대로 시작할 수도 없다", () => {
    const w = world();
    expect(opposed(w, seo, [w.hanC, "관찰력"], [w.seoC, "관찰력"])).toMatchObject({ ok: false, code: "forbidden" });
    const r = opposed(w, seo, [w.seoC, "관찰력"], [w.npc, "관찰력"]);
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(!r.ok && r.message).toContain("GM");
  });

  it("관전자는 굴릴 수 없고, 비밀 대항은 GM만", () => {
    const w = world();
    expect(opposed(w, spec, [w.seoC, "관찰력"], [w.hanC, "관찰력"])).toMatchObject({ ok: false, code: "forbidden" });
    expect(opposed(w, seo, [w.seoC, "관찰력"], [w.hanC, "관찰력"], true)).toMatchObject({ ok: false, code: "forbidden" });
    const outs = must(opposed(w, kp, [w.seoC, "관찰력"], [w.npc, "관찰력"], true));
    expect(outs.filter((o) => o.event.type === "roll.result").every((o) => !inAudience(o.audience, seo))).toBe(true);
    expect(outs.some((o) => o.event.type === "roll.hidden" && inAudience(o.audience, seo))).toBe(true);
  });

  it("같은 캐릭터끼리, 없는 캐릭터, 시트에 없는 기능은 거절한다", () => {
    const w = world();
    expect(opposed(w, kp, [w.seoC, "관찰력"], [w.seoC, "도서관 이용"])).toMatchObject({ ok: false, code: "bad_roll" });
    expect(opposed(w, kp, [w.seoC, "관찰력"], [{ ...w.npc, id: "nope" }, "관찰력"])).toMatchObject({ ok: false, code: "not_found" });
    const r = opposed(w, kp, [w.seoC, "관찰력"], [w.npc, "손놀림"]);
    expect(r).toMatchObject({ ok: false, code: "bad_roll" });
    expect(!r.ok && r.message).toBe("광신도의 '손놀림' 기능이 시트에 없어요.");
  });

  it("세션 전에는 PL이 못 하고, 일시정지 중에는 GM도 못 한다", () => {
    const w = world();
    w.room.handle(kp, cmd("session.pause", {}));
    expect(opposed(w, kp, [w.seoC, "관찰력"], [w.npc, "관찰력"])).toMatchObject({ ok: false, code: "paused" });
  });

  it("대항 판정은 굴림 기록 저장·복원에도 그대로 남는다", () => {
    const w = world();
    w.rng.next(...pct(40), ...pct(40));
    must(opposed(w, kp, [w.seoC, "관찰력"], [w.npc, "관찰력"]));
    const copy = Room.fromData(JSON.parse(JSON.stringify(w.room.toData())));
    expect(copy.snapshot(kp).rolls.at(-1)!.outcome).toMatchObject({ kind: "opposed", winner: "a" });
  });
});

describe("그룹 판정 (roll.group)", () => {
  const group = (w: World, who: Actor, d: Partial<Extract<ClientCommand, { type: "roll.group" }>["data"]> & { name: string }) =>
    w.room.handle(who, cmd("roll.group", { secret: false, ...d }));
  const outcomeOf = (outs: Out[]) => {
    const o = lastRoll(outs).outcome;
    if (o.kind !== "group") throw new Error("not group");
    return o;
  };

  it("PL들의 캐릭터가 한꺼번에 굴리고 한 항목으로 요약된다 (NPC 시트는 빠진다)", () => {
    const w = world();
    w.rng.next(...pct(30), ...pct(90)); // 서하 성공(60), 도윤 실패(60)
    const outs = must(group(w, kp, { name: "관찰력" }));
    expect(events(outs, "roll.result")).toHaveLength(1);
    const o = outcomeOf(outs);
    expect(o.entries.map((e) => [e.character, e.success, e.percent.total])).toEqual([
      ["윤서하", true, 30],
      ["한도윤", false, 90],
    ]);
    expect(o.successes).toBe(1);
    expect(o.summary).toBe("2명 중 1명이 성공했어요. 실패: 한도윤.");
  });

  it("난이도가 있으면 그 단계 이상이어야 성공 (어려움: 60의 절반 30 이하)", () => {
    const w = world();
    w.rng.next(...pct(30), ...pct(31));
    const o = outcomeOf(must(group(w, kp, { name: "관찰력", difficulty: "hard" })));
    expect(o.entries.map((e) => e.success)).toEqual([true, false]);
    expect(o.difficulty).toBe("hard");
  });

  it("특정 PL만 고를 수 있다", () => {
    const w = world();
    const o = outcomeOf(must(group(w, kp, { name: "관찰력", userIds: [han.userId] })));
    expect(o.entries.map((e) => e.character)).toEqual(["한도윤"]);
    expect(group(w, kp, { name: "관찰력", userIds: [spec.userId] })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("그 기능이 없는 캐릭터는 빠지고 이름을 알린다", () => {
    const w = world();
    must(w.room.handle(kp, cmd("sheet.patch", { characterId: w.hanC.id, ops: [{ path: "skill", name: "관찰력", value: 0 }] })));
    // 값이 0이어도 기능은 있다. 기능 자체가 없는 경우는 다른 기능 이름으로 확인한다.
    const o = outcomeOf(must(group(w, kp, { name: "도서관 이용" })));
    expect(o.skipped).toEqual([]);
    const w2 = world();
    const r = group(w2, kp, { name: "손놀림" });
    expect(r).toMatchObject({ ok: false, code: "not_found" });
  });

  it("누군가에게만 기능이 없으면 skipped에 이름이 남는다", () => {
    const w = world();
    // 한도윤만 가진 기능을 GM이 더해 준다
    must(w.room.handle(kp, cmd("sheet.patch", { characterId: w.hanC.id, ops: [{ path: "skill", name: "손놀림", value: 40 }] })));
    const o = outcomeOf(must(group(w, kp, { name: "손놀림" })));
    expect(o.entries.map((e) => e.character)).toEqual(["한도윤"]);
    expect(o.skipped).toEqual(["윤서하"]);
    expect(o.summary).toContain("손놀림이 없어서 빠진 사람: 윤서하");
  });

  it("GM만 요청하고, 비밀로도 굴릴 수 있다. 푸시·행운은 없다", () => {
    const w = world();
    expect(group(w, seo, { name: "관찰력" })).toMatchObject({ ok: false, code: "forbidden" });
    const outs = must(group(w, kp, { name: "관찰력", secret: true }));
    expect(outs.filter((o) => o.event.type === "roll.result").every((o) => !inAudience(o.audience, seo))).toBe(true);
    const entry = lastRoll(outs);
    expect(w.room.handle(kp, cmd("roll.push", { rollId: entry.id }))).toMatchObject({ ok: false });
  });

  it("PL 캐릭터가 하나도 없으면 거절한다", () => {
    const rng = makeRng();
    const room = new Room("r", { newId: () => `id-${++n}`, rng: rng.rng });
    room.join(kp);
    room.join(seo);
    room.handle(kp, cmd("session.start", {}));
    expect(room.handle(kp, cmd("roll.group", { name: "관찰력", secret: false }))).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("굴림 식 엔진 연결 (roll.request)", () => {
  const free = (w: World, who: Actor, expr: string, characterId?: string) => w.room.handle(who, cmd("roll.request", { secret: false, expr, ...(characterId ? { characterId } : {}) }));

  it("(2d6+6)*5 : 항별 결과와 계산식이 로그에 남는다", () => {
    const w = world();
    w.rng.next(face(1, 6), face(6, 6));
    const entry = lastRoll(must(free(w, seo, "(2d6+6)*5")));
    expect(entry.outcome).toMatchObject({ kind: "dice", total: 65, rolls: [1, 6], breakdown: "(2d6[1,6]+6)*5", terms: [{ text: "2d6", rolls: [1, 6], sum: 7 }] });
  });

  it("3d6*5, 1d6+1d4, d100", () => {
    const w = world();
    w.rng.next(face(3, 6), face(3, 6), face(3, 6));
    expect(lastRoll(must(free(w, kp, "3d6*5"))).outcome).toMatchObject({ total: 45 });
    w.rng.next(face(2, 6), face(3, 4));
    expect(lastRoll(must(free(w, kp, "1d6+1d4"))).outcome).toMatchObject({ total: 5 });
    w.rng.next(face(88, 100));
    expect(lastRoll(must(free(w, kp, "d100"))).outcome).toMatchObject({ total: 88 });
  });

  it("db: PL은 내 캐릭터의 피해 보너스를 쓴다 (STR 50 + SIZ 60 = 110 → 0)", () => {
    const w = world();
    w.rng.next(face(4, 10));
    expect(lastRoll(must(free(w, seo, "1d10+db"))).outcome).toMatchObject({ total: 4 });
  });

  it("db: 보너스가 주사위인 캐릭터 (STR+SIZ 140 → 1d4)", () => {
    const rng = makeRng();
    const room = new Room("r", { newId: () => `id-${++n}`, rng: rng.rng });
    for (const a of [kp, seo]) room.join(a);
    room.handle(kp, cmd("session.start", {}));
    const c = added(must(room.handle(seo, cmd("character.add", { ...sheet("거한", 60, 80), characteristics: { STR: 80, CON: 60, SIZ: 80, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 } }))));
    rng.next(face(4, 10), face(3, 4));
    const entry = lastRoll(must(room.handle(seo, cmd("roll.request", { secret: false, expr: "1d10+db", characterId: c.id }))));
    expect(entry.outcome).toMatchObject({ total: 7, rolls: [4, 3], terms: [{ text: "1d10" }, { text: "db(1d4)", rolls: [3], sum: 3 }] });
  });

  it("db: GM이 시트를 여럿 가졌으면 캐릭터를 골라야 한다. 시트가 하나뿐이면 그 시트를 쓴다", () => {
    const w = world();
    expect(free(w, kp, "1d6+db").ok).toBe(true); // GM 시트는 광신도 하나
    must(w.room.handle(kp, cmd("character.add", { ...sheet("또 다른 NPC", 50, 50), ownerId: kp.userId })));
    const r = free(w, kp, "1d6+db");
    expect(r).toMatchObject({ ok: false, code: "bad_roll" });
    expect(!r.ok && r.message).toContain("db");
    expect(free(w, kp, "1d6+db", w.npc.id).ok).toBe(true);
  });

  it("db: 남의 캐릭터는 고를 수 없다", () => {
    const w = world();
    expect(free(w, seo, "1d6+db", w.hanC.id)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("db: 캐릭터가 없는 PL은 안내를 받는다", () => {
    const rng = makeRng();
    const room = new Room("r", { newId: () => `id-${++n}`, rng: rng.rng });
    for (const a of [kp, seo]) room.join(a);
    room.handle(kp, cmd("session.start", {}));
    const r = room.handle(seo, cmd("roll.request", { secret: false, expr: "1d6+db" }));
    expect(r).toMatchObject({ ok: false, code: "bad_roll" });
    expect(!r.ok && r.message).toContain("캐릭터");
  });

  it("잘못된 식과 상한을 넘는 식은 친절한 한국어로 거절한다", () => {
    const w = world();
    for (const [expr, part] of [
      ["2d6+", "읽지"],
      ["1d6/0", "0으로"],
      ["1001d6", "1000"],
      ["1d10001", "면 수"],
      ["abc", "읽지"],
      ["(1000d10000)*100000", "너무 커"],
    ] as const) {
      const r = free(w, kp, expr);
      expect(r, expr).toMatchObject({ ok: false, code: "bad_roll" });
      expect(!r.ok && r.message, expr).toContain(part);
    }
  });

  it("무기 피해 식에도 엔진이 적용된다 (2d6+db/2)", () => {
    const w = world();
    must(w.room.handle(kp, cmd("sheet.patch", { characterId: w.npc.id, ops: [{ path: "weapons", value: [{ name: "도끼", skill: "관찰력", damage: "2d6+db/2" }] }] })));
    w.rng.next(face(3, 6), face(4, 6));
    expect(lastRoll(must(w.room.handle(kp, cmd("damage.roll", { characterId: w.npc.id, weaponIndex: 0 })))).outcome).toMatchObject({ total: 7 });
  });

  it("마이너스 피해 보너스로 피해가 음수가 되지는 않는다", () => {
    const rng = makeRng();
    const room = new Room("r", { newId: () => `id-${++n}`, rng: rng.rng });
    for (const a of [kp, seo]) room.join(a);
    room.handle(kp, cmd("session.start", {}));
    const c = added(
      must(
        room.handle(
          seo,
          cmd("character.add", { ...sheet("약골", 40, 40), characteristics: { STR: 30, CON: 40, SIZ: 30, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 }, weapons: [{ name: "돌", skill: "관찰력", damage: "1d3+db" }] }),
        ),
      ),
    );
    rng.next(face(1, 3));
    const o = lastRoll(must(room.handle(seo, cmd("damage.roll", { characterId: c.id, weaponIndex: 0 })))).outcome;
    expect(o).toMatchObject({ kind: "dice", total: 0 }); // 1 + (-2) = -1 → 0
  });

  it("푸시·행운 흐름은 그대로 동작한다", () => {
    const w = world();
    w.rng.next(...pct(70)); // 실패
    const first = lastRoll(must(w.room.handle(seo, cmd("roll.request", { secret: false, skill: { characterId: w.seoC.id, name: "관찰력", bonus: 0 } }))));
    expect(first.outcome).toMatchObject({ kind: "cc", success: false });
    w.rng.next(...pct(20));
    const pushed = lastRoll(must(w.room.handle(seo, cmd("roll.push", { rollId: first.id }))));
    expect(pushed.pushOf).toBe(first.id);
    w.rng.next(...pct(75));
    const second = lastRoll(must(w.room.handle(seo, cmd("roll.request", { secret: false, skill: { characterId: w.seoC.id, name: "도서관 이용", bonus: 0 } }))));
    const luck = lastRoll(must(w.room.handle(seo, cmd("luck.spend", { rollId: second.id }))));
    expect(luck.luckOf).toBe(second.id);
    expect(cur(w, w.seoC.id).luck).toBe(50 - 35);
  });
});
