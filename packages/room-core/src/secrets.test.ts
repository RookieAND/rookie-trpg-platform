import { describe, expect, it } from "vitest";
import type { ClientCommand, GameObject } from "@coc-vtt/shared";
import { Room, inAudience, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl1: Actor = { userId: "pl1", name: "서하", role: "pl" };
const pl2: Actor = { userId: "pl2", name: "도윤", role: "pl" };
const spec: Actor = { userId: "sp1", name: "관전", role: "spectator" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
/** 이 사람이 실제로 받는 이벤트만 JSON으로 합친다. */
const received = (out: Out[], who: Actor) => JSON.stringify(out.filter((o) => inAudience(o.audience, who)).map((o) => o.event));

const sheet = (name: string, dex: number) => ({
  name,
  age: 30,
  occupation: "",
  characteristics: { STR: 50, CON: 50, SIZ: 50, DEX: dex, APP: 50, INT: 50, POW: 50, EDU: 50 },
  luck: 50,
  skills: [],
  notes: "",
  backstory: "",
  possessions: "",
  weapons: [],
});

const setup = () => {
  const room = new Room("r", { newId: () => `id-${++n}`, rng: () => 0.5 });
  for (const a of [kp, pl1, pl2, spec]) room.join(a);
  must(room.handle(kp, cmd("session.start", {})));
  must(room.handle(pl1, cmd("character.add", sheet("윤서하", 60))));
  must(room.handle(pl2, cmd("character.add", sheet("한도윤", 55))));
  // GM이 만든 NPC 시트(주인이 GM)
  must(room.handle(kp, cmd("character.add", sheet("비밀교단원", 77))));
  return room;
};

describe("새 토큰의 소유자 없음(NPC)", () => {
  it("소유자 없는 토큰은 PL이 움직일 수 없고 GM은 움직일 수 있다", () => {
    const room = setup();
    const out = must(room.handle(kp, cmd("object.add", { kind: "token", name: "토큰1", x: 100, y: 100, layer: "object", visibleTo: "all" })));
    const tok = (out[0]!.event as { data: GameObject }).data;
    expect(tok.ownerId).toBeUndefined();
    const denied = room.handle(pl1, cmd("object.move", { id: tok.id, x: 300, y: 300, rev: tok.rev }));
    expect(denied.ok).toBe(false);
    expect(room.snapshot(pl1).objects.find((o) => o.id === tok.id)).toMatchObject({ x: 100, y: 100 });
    expect(room.handle(kp, cmd("object.move", { id: tok.id, x: 300, y: 300, rev: tok.rev })).ok).toBe(true);
  });
});

describe("전투 순서: NPC 시트는 PL에게 가려서 보낸다", () => {
  it("시작할 때 PL·관전자 이벤트와 snapshot에 NPC의 이름·DEX·시트 id가 없다", () => {
    const room = setup();
    const out = must(room.handle(kp, cmd("initiative.start", {})));
    for (const who of [pl1, pl2, spec]) {
      const json = received(out, who);
      expect(json).not.toContain("비밀교단원");
      expect(json).not.toContain("77");
      const snap = JSON.stringify(room.snapshot(who).initiative);
      expect(snap).not.toContain("비밀교단원");
      expect(snap).not.toContain("77");
    }
    // PL 자신과 동료 PL의 칸은 그대로 보인다
    const view = room.snapshot(pl1).initiative!;
    expect(view.entries.map((e) => e.name)).toEqual(["알 수 없는 상대", "윤서하", "한도윤"]);
    expect(view.entries[0]).toEqual({ id: expect.any(String), name: "알 수 없는 상대", dex: 0, hidden: true });
    expect(view.entries[1]).toMatchObject({ dex: 60 });
  });

  it("GM은 모든 칸을 그대로 받고, 차례 위치는 PL과 같다", () => {
    const room = setup();
    const out = must(room.handle(kp, cmd("initiative.start", {})));
    expect(received(out, kp)).toContain("비밀교단원");
    const gm = room.snapshot(kp).initiative!;
    const pl = room.snapshot(pl1).initiative!;
    expect(gm.entries.map((e) => e.id)).toEqual(pl.entries.map((e) => e.id));
    expect(gm.entries[0]).toMatchObject({ name: "비밀교단원", dex: 77 });
    const next = must(room.handle(kp, cmd("initiative.next", {})));
    expect(received(next, pl1)).not.toContain("비밀교단원");
  });

  it("GM이 직접 이름을 적어 넣은 NPC 칸은 보인다(공개하겠다는 뜻)", () => {
    const room = setup();
    must(room.handle(kp, cmd("initiative.start", {})));
    const out = must(room.handle(kp, cmd("initiative.add", { name: "경비병", dex: 40 })));
    expect(received(out, pl1)).toContain("경비병");
  });
});

describe("세션 종료 요약: NPC 시트는 PL에게 안 보인다", () => {
  it("SAN 보상·성장 기록에 NPC 시트가 PL에게는 빠지고 GM에게는 남는다", () => {
    const room = setup();
    const out = must(room.handle(kp, cmd("session.end", { sanReward: "1d6", growth: true })));
    const plJson = received(out, pl1);
    expect(plJson).toContain("session.ended");
    expect(plJson).toContain("윤서하");
    expect(plJson).not.toContain("비밀교단원");
    expect(received(out, spec)).not.toContain("비밀교단원");
    expect(received(out, kp)).toContain("비밀교단원");
    // NPC 시트가 바뀐 character.updated도 PL에게 가지 않는다
    expect(received(out, pl2)).not.toContain("비밀교단원");
  });
});

describe("숨긴 토큰의 시야 원", () => {
  const withFog = () => {
    const room = setup();
    const add = (extra: Partial<Extract<ClientCommand, { type: "object.add" }>["data"]>) =>
      (must(room.handle(kp, cmd("object.add", { kind: "token", name: "t", x: 700, y: 500, layer: "object", visibleTo: "all", ...extra })))[0]!.event as { data: GameObject }).data;
    must(room.handle(kp, cmd("scene.fog", { id: "main", enabled: true })));
    return { room, add };
  };

  it("GM 층 토큰에 시야를 줘도 PL이 받는 이벤트·snapshot에 그 원이 없다", () => {
    const { room, add } = withFog();
    const lamp = add({ name: "숨은 등불", layer: "gm" });
    const out = must(room.handle(kp, cmd("object.update", { id: lamp.id, vision: 123 })));
    expect(received(out, pl1)).not.toContain("123");
    expect(JSON.stringify(room.snapshot(pl1).scenes)).not.toContain("700");
    expect(room.snapshot(pl1).scenes[0]!.fogAreas).toEqual([]);
  });

  it("숨긴 토큰이 움직여도 PL에게 새는 게 없고, 공개하면 그때부터 원이 보인다", () => {
    const { room, add } = withFog();
    const lamp = add({ name: "숨은 등불", visibleTo: "gm" });
    must(room.handle(kp, cmd("object.update", { id: lamp.id, vision: 90 })));
    const moved = must(room.handle(kp, cmd("object.move", { id: lamp.id, x: 710, y: 510, rev: room.snapshot(kp).objects.find((o) => o.id === lamp.id)!.rev })));
    expect(received(moved, pl1)).not.toContain("710");
    must(room.handle(kp, cmd("object.update", { id: lamp.id, visibleTo: "all" })));
    expect(room.snapshot(pl1).scenes[0]!.fogAreas).toEqual([{ x: 710, y: 510, r: 90 }]);
  });
});
