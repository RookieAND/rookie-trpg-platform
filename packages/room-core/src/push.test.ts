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

const setup = (rng: Rng, luck = 55) => {
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
        luck,
        skills: [{ name: "도서관 이용", value: 60, grown: false }],
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

const skillRoll = (room: Room, who: Actor, id: string, difficulty?: "regular" | "hard" | "extreme") => {
  const outs = must(room.handle(who, cmd("roll.request", { secret: false, skill: { characterId: id, name: "도서관 이용", bonus: 0, ...(difficulty ? { difficulty } : {}) } })));
  const ev = outs[0]!.event;
  if (ev.type !== "roll.result") throw new Error();
  return ev.data;
};
const logOf = (outs: Out[]) => {
  const ev = outs.find((o) => o.event.type === "roll.result")!.event;
  if (ev.type !== "roll.result") throw new Error();
  return ev.data;
};

// 실패(89) 다음 값들
const FAIL = [0.9, 0.8];

describe("푸시 굴림", () => {
  it("실패한 시트 판정을 같은 조건으로 한 번 더 굴린다", () => {
    const { room, id } = setup(seq(...FAIL, 0.3, 0.2));
    const first = skillRoll(room, seo, id);
    expect(first.check).toEqual({ characterId: id, name: "도서관 이용", bonus: 0 });
    const pushed = logOf(must(room.handle(seo, cmd("roll.push", { rollId: first.id }))));
    expect(pushed).toMatchObject({ pushOf: first.id, label: first.label, outcome: { kind: "cc", success: true } });
  });

  it("한 굴림은 한 번만 푸시하고, 푸시한 굴림은 다시 푸시할 수 없다", () => {
    const { room, id } = setup(seq(...FAIL));
    const first = skillRoll(room, seo, id);
    const pushed = logOf(must(room.handle(seo, cmd("roll.push", { rollId: first.id }))));
    expect(room.handle(seo, cmd("roll.push", { rollId: first.id })).ok).toBe(false);
    expect(room.handle(seo, cmd("roll.push", { rollId: pushed.id })).ok).toBe(false);
  });

  it("성공한 굴림, 직접 입력한 굴림, 남의 굴림은 푸시할 수 없다", () => {
    const { room, id } = setup(seq(0.3, 0.2, ...FAIL, ...FAIL));
    const ok = skillRoll(room, seo, id);
    expect(room.handle(seo, cmd("roll.push", { rollId: ok.id })).ok).toBe(false);
    const failed = skillRoll(room, seo, id);
    expect(room.handle(han, cmd("roll.push", { rollId: failed.id })).ok).toBe(false);
    expect(room.handle(spec, cmd("roll.push", { rollId: failed.id })).ok).toBe(false);
    const manual = logOf(must(room.handle(seo, cmd("roll.request", { secret: false, expr: "CC<=60" }))));
    expect(room.handle(seo, cmd("roll.push", { rollId: manual.id })).ok).toBe(false);
  });

  it("KP는 대신 푸시할 수 있다", () => {
    const { room, id } = setup(seq(...FAIL));
    const first = skillRoll(room, seo, id);
    expect(room.handle(kp, cmd("roll.push", { rollId: first.id })).ok).toBe(true);
  });
});

describe("행운 소비", () => {
  it("실패를 성공으로 바꿀 만큼만 쓰고 로그에 남긴다", () => {
    const { room, id } = setup(seq(...FAIL));
    const first = skillRoll(room, seo, id);
    const outs = must(room.handle(seo, cmd("luck.spend", { rollId: first.id })));
    const entry = logOf(outs);
    expect(entry).toMatchObject({ luckOf: first.id, outcome: { success: true, luckSpent: 29, percent: { total: 60 } } });
    const sheet = outs.find((o) => o.event.type === "character.updated")!.event;
    if (sheet.type !== "character.updated") throw new Error();
    expect(sheet.data.luck).toBe(26);
  });

  it("행운이 모자라면 거절하고 아무것도 바꾸지 않는다", () => {
    const { room, id } = setup(seq(...FAIL), 10);
    const first = skillRoll(room, seo, id);
    expect(room.handle(seo, cmd("luck.spend", { rollId: first.id })).ok).toBe(false);
    expect(room.snapshot(seo).characters[0]!.luck).toBe(10);
  });

  it("한 굴림에 한 번만 쓰고, 남의 굴림에는 쓸 수 없다", () => {
    const { room, id } = setup(seq(...FAIL));
    const first = skillRoll(room, seo, id);
    expect(room.handle(han, cmd("luck.spend", { rollId: first.id })).ok).toBe(false);
    must(room.handle(seo, cmd("luck.spend", { rollId: first.id })));
    expect(room.handle(seo, cmd("luck.spend", { rollId: first.id })).ok).toBe(false);
  });

  it("어려움 난이도는 그 기준까지 낮춰야 한다", () => {
    const { room, id } = setup(seq(0.9, 0.5), 59);
    const first = skillRoll(room, seo, id, "hard"); // 59, 기준 30 → 29
    const outs = must(room.handle(seo, cmd("luck.spend", { rollId: first.id })));
    expect(logOf(outs).outcome).toMatchObject({ level: "hard", success: true, luckSpent: 29 });
  });
});
