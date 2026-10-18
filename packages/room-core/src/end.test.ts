import { describe, expect, it } from "vitest";
import type { ClientCommand, Rng } from "@coc-vtt/shared";
import { inAudience, Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const seo: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const han: Actor = { userId: "pl2", name: "한도윤", role: "pl" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const fixed = (...values: number[]): Rng => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

const sheet = (skills: Array<{ name: string; value: number; grown: boolean }>, over: Record<string, unknown> = {}) =>
  ({
    name: "윤서하",
    age: 27,
    occupation: "기자",
    characteristics: { STR: 50, CON: 60, SIZ: 60, DEX: 60, APP: 50, INT: 70, POW: 60, EDU: 70 },
    luck: 55,
    skills,
    ...over,
  }) as Extract<ClientCommand, { type: "character.add" }>["data"];

const started = (rng: Rng, skills = [{ name: "도서관 이용", value: 60, grown: true }, { name: "심리학", value: 40, grown: true }], over = {}) => {
  const room = new Room("r", { newId: () => `id-${++n}`, rng });
  for (const a of [kp, seo, han]) room.join(a);
  room.handle(kp, cmd("session.start", {}));
  const added = must(room.handle(seo, cmd("character.add", sheet(skills, over))))[0]!.event;
  if (added.type !== "character.added") throw new Error("no add");
  return { room, id: added.data.id };
};

const ended = (outs: Out[]) => {
  const ev = outs.find((o) => o.event.type === "session.ended")!.event;
  if (ev.type !== "session.ended") throw new Error("no end");
  return ev.data;
};

describe("세션 종료 정산", () => {
  it("성장 표시가 된 기능마다 굴려 성공하면 올리고, 표시는 모두 지운다", () => {
    // 도서관: d100 0.70→71 > 60 성공, +d10 0.2→3 → 63 / 심리학: 0.2→21 ≤ 40 실패
    const { room, id } = started(fixed(0.7, 0.2, 0.2));
    const outs = must(room.handle(kp, cmd("session.end", { growth: true })));
    const g = ended(outs).growth!;
    expect(g).toEqual([
      { characterId: id, name: "윤서하", skill: "도서관 이용", roll: 71, before: 60, after: 63, success: true },
      { characterId: id, name: "윤서하", skill: "심리학", roll: 21, before: 40, after: 40, success: false },
    ]);
    const upd = outs.find((o) => o.event.type === "character.updated")!;
    if (upd.event.type !== "character.updated") throw new Error();
    expect(upd.event.data.skills["도서관 이용"]).toEqual({ value: 63, grown: false });
    expect(upd.event.data.skills["심리학"]).toEqual({ value: 40, grown: false });
    expect(upd.event.data.rev).toBe(1);
  });

  it("96 이상이면 현재값이 높아도 성공한다", () => {
    const { room } = started(fixed(0.95, 0.4), [{ name: "도서관 이용", value: 98, grown: true }]);
    const g = ended(must(room.handle(kp, cmd("session.end", { growth: true })))).growth!;
    expect(g[0]).toMatchObject({ roll: 96, success: true, before: 98, after: 100 });
  });

  it("growth를 켜지 않으면 굴리지 않고 표시도 그대로 둔다", () => {
    const { room } = started(fixed(0.7));
    const outs = must(room.handle(kp, cmd("session.end", {})));
    expect(outs.map((o) => o.event.type)).toEqual(["session.ended"]);
    expect(ended(outs)).toEqual({});
  });

  it("SAN 보상을 참가자마다 굴려 더하고 최대치를 넘지 않는다", () => {
    const { room, id } = started(fixed(0.5), [], {});
    const outs = must(room.handle(kp, cmd("session.end", { sanReward: "1d6", ending: "새벽의 생존자" })));
    const s = ended(outs);
    expect(s.ending).toBe("새벽의 생존자");
    expect(s.sanRewards).toEqual([{ characterId: id, name: "윤서하", roll: 4, before: 60, after: 64 }]);

    const hi = started(fixed(0.99), [], { san: 97 });
    const s2 = ended(must(hi.room.handle(kp, cmd("session.end", { sanReward: "1d6" }))));
    expect(s2.sanRewards![0]).toMatchObject({ before: 97, after: 99 });
  });

  it("합산 식 보상은 항마다 굴려 더한다", () => {
    const { room, id } = started(fixed(0.5), [], {});
    const s = ended(must(room.handle(kp, cmd("session.end", { sanReward: "1d6+1d4+2" }))));
    // 0.5 -> d6=4, d4=3, 상수 2
    expect(s.sanRewards).toEqual([{ characterId: id, name: "윤서하", roll: 9, before: 60, after: 69 }]);
  });

  it("주사위 식이 아닌 보상은 거절하고 세션은 그대로 둔다", () => {
    const { room } = started(fixed(0.5));
    for (const bad of ["abc", "CC<=50", "1d0", "1d6+", "1d6-1d4", "101d6"]) {
      const r = room.handle(kp, cmd("session.end", { sanReward: bad }));
      expect(r.ok).toBe(false);
    }
    expect(room.sessionStatus).toBe("ACTIVE");
  });

  it("바뀐 시트는 주인과 GM에게만 가고, 정산 결과는 모두에게 간다", () => {
    const { room } = started(fixed(0.7, 0.2, 0.2));
    const outs = must(room.handle(kp, cmd("session.end", { growth: true })));
    const upd = outs.find((o) => o.event.type === "character.updated")!;
    expect(inAudience(upd.audience, kp)).toBe(true);
    expect(inAudience(upd.audience, seo)).toBe(true);
    expect(inAudience(upd.audience, han)).toBe(false);
    const end = outs.find((o) => o.event.type === "session.ended")!;
    expect(inAudience(end.audience, han)).toBe(true);
  });

  it("PL은 정산하며 끝낼 수 없다", () => {
    const { room } = started(fixed(0.5));
    expect(room.handle(seo, cmd("session.end", { growth: true })).ok).toBe(false);
  });
});
