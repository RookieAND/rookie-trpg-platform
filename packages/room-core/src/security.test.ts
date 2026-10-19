import { describe, expect, it } from "vitest";
import type { ClientCommand } from "@coc-vtt/shared";
import { Room, inAudience, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl1: Actor = { userId: "pl1", name: "서하", role: "pl" };
const pl2: Actor = { userId: "pl2", name: "도윤", role: "pl" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const sheet = (name: string) => ({
  name,
  age: 30,
  occupation: "",
  characteristics: { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 },
  luck: 50,
  skills: [{ name: "심리학", value: 40, grown: false }],
});

const room = () => {
  const r = new Room("r", { newId: () => `id-${++n}`, rng: () => 0.5 });
  for (const a of [kp, pl1, pl2]) r.join(a);
  must(r.handle(kp, cmd("session.start", {})));
  must(r.handle(pl1, cmd("character.add", sheet("윤서하") as never)));
  return { r, id: r.snapshot(pl1).characters[0]!.id };
};

describe("S-09 PL이 자기 수치를 직접 고치는 것을 GM이 끌 수 있다", () => {
  it("기본은 켜짐이라 PL이 HP·MP·SAN·행운을 고칠 수 있다", () => {
    const { r, id } = room();
    expect(r.snapshot(pl1).chatSettings?.plSelfEdit).toBe(true);
    for (const path of ["hp", "mp", "san", "luck"] as const) {
      expect(r.handle(pl1, cmd("sheet.patch", { characterId: id, ops: [{ path, delta: -1 }] })).ok, path).toBe(true);
    }
  });

  it("끄면 PL의 수치 수정은 거절되고, 글·성장 표시와 GM의 수정은 그대로 된다", () => {
    const { r, id } = room();
    must(r.handle(kp, cmd("settings.chat", { plWhisper: false, plSelfEdit: false })));
    const before = JSON.stringify(r.snapshot(pl1).characters);
    for (const path of ["hp", "mp", "san", "luck"] as const) {
      const res = r.handle(pl1, cmd("sheet.patch", { characterId: id, ops: [{ path, value: 99 }] }));
      expect(res, path).toMatchObject({ ok: false, code: "forbidden" });
    }
    // 섞어 보내도 통째로 거절 (몰래 끼워 넣지 못한다)
    expect(r.handle(pl1, cmd("sheet.patch", { characterId: id, ops: [{ path: "notes", value: "x" }, { path: "luck", value: 99 }] }))).toMatchObject({ ok: false });
    expect(JSON.stringify(r.snapshot(pl1).characters)).toBe(before);
    expect(r.handle(pl1, cmd("sheet.patch", { characterId: id, ops: [{ path: "notes", value: "메모" }, { path: "skill", name: "심리학", grown: true }] })).ok).toBe(true);
    expect(r.handle(kp, cmd("sheet.patch", { characterId: id, ops: [{ path: "luck", value: 10 }, { path: "hp", delta: -1 }] })).ok).toBe(true);
    expect(r.snapshot(kp).characters[0]!.luck).toBe(10);
  });

  it("끄고 있어도 정해진 명령(SAN 판정)으로는 수치가 바뀐다", () => {
    const { r, id } = room();
    must(r.handle(kp, cmd("settings.chat", { plWhisper: false, plSelfEdit: false })));
    const san = r.snapshot(pl1).characters[0]!.san;
    must(r.handle(pl1, cmd("san.check", { characterId: id, loss: "3/3" })));
    expect(r.snapshot(pl1).characters[0]!.san).toBeLessThan(san);
  });

  it("설정은 GM만 바꾸고, 바뀐 값이 모두에게 알려지며 저장·복원된다", () => {
    const { r } = room();
    expect(r.handle(pl1, cmd("settings.chat", { plWhisper: false, plSelfEdit: false }))).toMatchObject({ ok: false, code: "forbidden" });
    const out = must(r.handle(kp, cmd("settings.chat", { plWhisper: false, plSelfEdit: false })));
    const ev = out.find((o) => o.event.type === "settings.chat")!;
    expect(ev.event.data).toMatchObject({ plSelfEdit: false });
    expect(inAudience(ev.audience, pl1)).toBe(true);
    // plSelfEdit를 생략한 옛 클라이언트의 설정 변경이 값을 되돌리지 않는다
    must(r.handle(kp, cmd("settings.chat", { plWhisper: true })));
    expect(r.snapshot(pl1).chatSettings?.plSelfEdit).toBe(false);
    const back = Room.fromData(JSON.parse(JSON.stringify(r.toData())));
    expect(back.snapshot(pl1).chatSettings?.plSelfEdit).toBe(false);
  });

  it("옛 저장 데이터(설정에 plSelfEdit 없음)는 켜짐으로 열린다", () => {
    const { r } = room();
    const data = JSON.parse(JSON.stringify(r.toData()));
    delete data.chatSettings.plSelfEdit;
    expect(Room.fromData(data).snapshot(pl1).chatSettings?.plSelfEdit).toBe(true);
  });
});

describe("S-10 표시 이름", () => {
  it("제어·방향 문자를 지우고 공백을 줄인다", () => {
    const r = new Room("r");
    r.join(kp);
    r.join({ userId: "x", name: "  ‮evil‬ \n 이름\t\t", role: "pl" });
    expect(r.snapshot(kp).members.find((m) => m.userId === "x")!.name).toBe("evil 이름");
  });

  it("PL이 GM·KP 같은 이름을 쓰면 구분 표시가 붙고, 진짜 GM은 그대로다", () => {
    const r = new Room("r");
    r.join({ userId: "kp1", name: "GM", role: "kp" });
    r.join({ userId: "p", name: "G M", role: "pl" });
    r.join({ userId: "s", name: "지엠", role: "spectator" });
    const names = Object.fromEntries(r.snapshot({ userId: "kp1", role: "kp" }).members.map((m) => [m.userId, m.name]));
    expect(names).toEqual({ kp1: "GM", p: "G M (참가자)", s: "지엠 (참가자)" });
  });

  it("40자를 넘는 이름은 자른다", () => {
    const r = new Room("r");
    r.join({ userId: "x", name: "가".repeat(80), role: "pl" });
    expect(Array.from(r.snapshot({ userId: "x", role: "pl" }).members[0]!.name)).toHaveLength(40);
  });
});

describe("S-08 기록 비우기", () => {
  const talk = () => {
    const { r } = room();
    must(r.handle(pl1, cmd("chat.send", { text: "공개 대사" })));
    must(r.handle(kp, cmd("chat.send", { text: "귓속말 내용", to: "pl1" })));
    must(r.handle(pl1, cmd("roll.request", { expr: "1d100", secret: false })));
    return r;
  };

  it("대화를 비우면 모두의 대화와 저장 데이터에서 사라지고, 다시 접속해도 되받지 않는다", () => {
    const r = talk();
    expect(r.chatHistory(kp).length).toBeGreaterThan(0);
    const seqBefore = r.currentSeq;
    const out = r.purgeHistory({ chat: true, log: false });
    expect(out.map((o) => o.event.type)).toEqual(["history.purged"]);
    expect(inAudience(out[0]!.audience, pl2)).toBe(true);
    expect(r.chatHistory(kp)).toEqual([]);
    expect(r.chatHistory(pl1)).toEqual([]);
    expect(r.toData().chat).toEqual([]);
    expect(JSON.stringify(r.toData())).not.toContain("귓속말 내용");
    // 끊겼다 다시 붙은 화면이 옛 이벤트로 지운 대화를 받지 못한다
    const replay = r.eventsSince(pl1, 0);
    expect(JSON.stringify(replay ?? [])).not.toContain("귓속말 내용");
    expect(JSON.stringify(replay ?? [])).not.toContain("공개 대사");
    expect(r.currentSeq).toBeGreaterThan(seqBefore);
    // 세션 기록은 그대로
    expect(r.logFor({ userId: "kp1", role: "kp" }).total).toBeGreaterThan(0);
  });

  it("세션 기록을 비우면 '비웠다'는 한 줄만 GM에게 남는다", () => {
    const r = talk();
    r.purgeHistory({ chat: false, log: true });
    const gm = r.logFor({ userId: "kp1", role: "kp" });
    expect(gm.total).toBe(1);
    expect(gm.entries[0]!.text).toContain("비웠어요");
    expect(r.logFor({ userId: "pl1", role: "pl" }).total).toBe(0);
    expect(r.chatHistory(kp).length).toBeGreaterThan(0); // 대화는 그대로
    // 번호는 이어진다
    must(r.handle(kp, cmd("session.pause", {})));
    expect(Math.max(...r.logFor({ userId: "kp1", role: "kp" }).entries.map((e) => e.n))).toBeGreaterThan(gm.entries[0]!.n);
  });
});
