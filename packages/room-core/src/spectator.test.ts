import { describe, expect, it } from "vitest";
import { clientCommandSchema, type ClientCommand, type GameObject, type Handout } from "@coc-vtt/shared";
import { Room, inAudience, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl1: Actor = { userId: "pl1", name: "서하", role: "pl" };
const pl2: Actor = { userId: "pl2", name: "도윤", role: "pl" };
const spec: Actor = { userId: "sp1", name: "관전", role: "spectator" };
const spec2: Actor = { userId: "sp2", name: "구경", role: "spectator" };

let n = 0;
let clock = 1_000_000;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const sheet = (name: string, dex: number) => ({
  name,
  age: 30,
  occupation: "",
  characteristics: { STR: 50, CON: 50, SIZ: 50, DEX: dex, APP: 50, INT: 50, POW: 50, EDU: 50 },
  luck: 50,
  skills: [{ name: "심리학", value: 40, grown: false }],
  notes: "",
  backstory: "",
  possessions: "",
  weapons: [{ name: "단검", skill: "격투", damage: "1d4" }],
});

/** 비밀이 든 문구. 관전자가 받는 어떤 프레임에도 이 글자가 들어 있으면 안 된다. */
const SECRET = "SECRET_";

interface World {
  room: Room;
  all: Out[];
  ids: { token: string; hidden: string; scene2: string; handoutPub: string; handoutGm: string; handoutPl: string; npc: string; plSheet: string; beat: string; beat2: string; branch: string; track: string; roll: string; zone: string };
  run: (who: Actor, c: ClientCommand) => Out[];
}

/** 모든 종류의 비밀을 심은 룸. GM과 PL이 하는 일을 전부 all에 모은다. */
const world = (): World => {
  const room = new Room("r", { newId: () => `id-${++n}`, now: () => (clock += 3000), rng: () => 0.5 });
  const all: Out[] = [];
  const run = (who: Actor, c: ClientCommand): Out[] => {
    const out = must(room.handle(who, c));
    all.push(...out);
    return out;
  };
  for (const a of [kp, pl1, pl2, spec]) all.push(...room.join(a));
  run(kp, cmd("settings.madness", { entries: [`${SECRET}광기표`] }));
  run(kp, cmd("audio.track.add", { label: `${SECRET}음원`, kind: "bgm", assetId: "a".repeat(32), volume: 50 }));
  const track = room.snapshot(kp).audioLibrary[0]!.id;
  run(kp, cmd("session.start", {}));
  run(pl1, cmd("character.add", sheet("윤서하", 60)));
  run(kp, cmd("character.add", sheet(`${SECRET}교단원`, 77)));
  const chars = room.snapshot(kp).characters;
  const plSheet = chars.find((c) => c.name === "윤서하")!.id;
  const npc = chars.find((c) => c.name.startsWith(SECRET))!.id;
  const tok = run(kp, cmd("object.add", { kind: "token", name: "서하", x: 100, y: 100, layer: "object", visibleTo: "all", ownerId: "pl1", characterId: plSheet }));
  const token = (tok.find((o) => o.event.type === "object.added")!.event as { data: GameObject }).data.id;
  const hid = run(kp, cmd("object.add", { kind: "token", name: `${SECRET}숨은토큰`, x: 300, y: 300, layer: "gm", visibleTo: "gm" }));
  const hidden = (hid.find((o) => o.event.type === "object.added")!.event as { data: GameObject }).data.id;
  run(kp, cmd("object.marker", { id: token, key: "poison", on: true, secret: true }));
  run(kp, cmd("object.marker", { id: token, key: "fear", on: true }));
  run(pl1, cmd("object.marker", { id: token, key: "focus", on: true }));
  run(kp, cmd("scene.create", { name: "다음 장면" }));
  const scene2 = [...Object.values(room.snapshot(kp).scenes)].find((s) => s.name === "다음 장면")!.id;
  // 아직 열지 않은 장면의 이름은 GM만 안다
  run(kp, cmd("scene.create", { name: `${SECRET}준비 중 장면` }));
  run(kp, cmd("scene.fog", { id: "main", enabled: true }));
  run(kp, cmd("fog.reveal", { sceneId: "main", x: 100, y: 100, r: 150 }));
  const zone = room.snapshot(kp).scenes.find((s) => s.id === "main")!.fog!.zones[0]!.id;
  const mk = (title: string, visibleTo: Handout["visibleTo"]) => {
    const o = run(kp, cmd("handout.create", { title, body: `${title} 본문`, visibleTo }));
    return (o.find((x) => x.event.type === "handout.added")!.event as { data: Handout }).data.id;
  };
  const handoutPub = mk("공개 편지", "all");
  const handoutGm = mk(`${SECRET}GM 노트`, "gm");
  const handoutPl = mk(`${SECRET}서하에게만`, ["pl1"]);
  run(kp, cmd("handout.show", { id: handoutPub }));
  run(kp, cmd("handout.update", { id: handoutPl, body: "고침" }));
  run(kp, cmd("flow.beat.upsert", { name: "도입", kind: "start", memo: `${SECRET}메모`, handoutIds: [] }));
  run(kp, cmd("flow.beat.upsert", { name: "끝", kind: "ending", memo: "", handoutIds: [] }));
  const beats = room.snapshot(kp).flow!.beats;
  run(kp, cmd("flow.branch.upsert", { from: beats[0]!.id, to: beats[1]!.id, label: `${SECRET}분기`, condition: { type: "manual" } }));
  const branch = room.snapshot(kp).flow!.branches[0]!.id;
  run(kp, cmd("chat.send", { text: "안녕하세요" }));
  run(kp, cmd("chat.send", { text: `/w 서하 ${SECRET}귓속말` }));
  run(kp, cmd("chat.send", { text: `/hr 1d100` }));
  run(kp, cmd("roll.request", { expr: "1d100", secret: true }));
  const pub = run(pl1, cmd("roll.request", { expr: "1d20", secret: false }));
  const roll = (pub.find((o) => o.event.type === "roll.result")!.event as { data: { id: string } }).data.id;
  run(kp, cmd("roll.ask", { name: "듣기", targetUserId: "pl1" }));
  run(pl1, cmd("roll.request", { secret: false, skill: { characterId: plSheet, name: "심리학", bonus: 0 } }));
  run(kp, cmd("san.check", { characterId: plSheet, loss: "0/1" }));
  run(kp, cmd("damage.apply", { characterId: npc, amount: 2, armor: 0 }));
  run(kp, cmd("sheet.patch", { characterId: npc, ops: [{ path: "notes", value: `${SECRET}NPC 노트` }] }));
  run(kp, cmd("initiative.start", {}));
  run(kp, cmd("initiative.next", {}));
  run(kp, cmd("audio.play", { trackId: track, fadeMs: 0 }));
  run(kp, cmd("audio.stop", { fadeMs: 0 }));
  run(kp, cmd("object.move", { id: token, x: 120, y: 120, rev: room.snapshot(kp).objects.find((o) => o.id === token)!.rev }));
  run(kp, cmd("object.update", { id: hidden, name: `${SECRET}숨은토큰2` }));
  run(kp, cmd("object.update", { id: token, layer: "gm" }));
  run(kp, cmd("object.update", { id: token, layer: "object" }));
  run(kp, cmd("scene.activate", { id: scene2, transition: "cut" }));
  run(kp, cmd("scene.activate", { id: "main", transition: "fade" }));
  run(kp, cmd("session.pause", {}));
  run(kp, cmd("session.resume", {}));
  run(kp, cmd("session.end", { ending: "끝", sanReward: "1d6", growth: true }));
  return { room, all, ids: { token, hidden, scene2, handoutPub, handoutGm, handoutPl, npc, plSheet, beat: beats[0]!.id, beat2: beats[1]!.id, branch, track, roll, zone }, run };
};

/** 관전자가 받는 프레임 종류. 이 밖의 종류가 오면 새 이벤트가 관전자에게 새는지 먼저 따져 봐야 한다. */
const SPECTATOR_FRAMES = new Set<string>([
  "presence",
  "object.added",
  "object.updated",
  "object.removed",
  "board.pinged",
  "settings.effects",
  "initiative.updated",
  "scene.updated",
  "scene.activated",
  "handout.added",
  "handout.updated",
  "handout.removed",
  "handout.shown",
  "roll.result",
  "roll.hidden",
  "roll.asked",
  "chat.posted",
  "settings.chat",
  "session.started",
  "session.paused",
  "session.resumed",
  "session.ended",
  "kp.away",
  "kp.back",
  "audio.play",
  "audio.stopped",
  "audio.volume",
]);

describe("관전자가 받는 모든 프레임", () => {
  it("받은 프레임 종류가 허용 목록 안이고, 어디에도 GM 전용 글이 없다", () => {
    const { room, all } = world();
    const mine = all.filter((o) => inAudience(o.audience, spec));
    const types = new Set<string>(mine.map((o) => o.event.type));
    for (const t of types) expect(SPECTATOR_FRAMES.has(t), `허용하지 않은 프레임 ${t}`).toBe(true);
    // 허용한 것들이 실제로 오는지도 본다(보드·공개 굴림·핸드아웃·대화)
    for (const t of ["object.added", "roll.result", "handout.added", "chat.posted", "roll.hidden", "session.ended"]) expect(types.has(t), t).toBe(true);
    for (const o of mine) expect(JSON.stringify(o.event), `${o.event.type}에 비밀이 샜어요`).not.toContain(SECRET);
    // 접속하면 받는 snapshot·최근 대화·기록·시나리오 저장 밖의 것
    expect(JSON.stringify(room.snapshot(spec))).not.toContain(SECRET);
    expect(JSON.stringify(room.chatHistory(spec))).not.toContain(SECRET);
    expect(JSON.stringify(room.logFor({ userId: spec.userId, role: "spectator" }))).not.toContain(SECRET);
    expect(JSON.stringify(room.chatPage({ userId: spec.userId, role: "spectator" }, 9999))).not.toContain(SECRET);
  });

  it("snapshot에는 보드·공개 굴림·모두에게 열린 핸드아웃만 있고 시트·GM 자료는 비어 있다", () => {
    const { room, ids } = world();
    const s = room.snapshot(spec);
    expect(s.characters).toEqual([]);
    expect(s.flow).toBeNull();
    expect(s.audioLibrary).toEqual([]);
    expect(s.madnessTable).toEqual([]);
    expect(s.damageApplied).toEqual({});
    expect(s.handouts.map((h) => h.id)).toEqual([ids.handoutPub]);
    expect(s.rolls.every((r) => !r.secret)).toBe(true);
    expect(Object.keys(s.scenes)).toHaveLength(1);
    expect(s.objects.map((o) => o.name)).toEqual(["서하"]);
    // 안개 원이 있는 활성 장면에는 시야만 담긴다(GM이 정한 영역 목록 zones는 없다)
    expect(s.scenes.find((sc) => sc.id === s.activeSceneId)!.fog).toBeUndefined();
    // 초기 전투 순서에서 NPC 칸은 가려진다
    expect(JSON.stringify(s.initiative)).not.toContain("교단원");
    // PL의 시트에 이어진 토큰이어도 시트 id는 모른다. 비밀 표식도 없고 공개 표식만 있다.
    const tok = s.objects[0]!;
    expect(tok.characterId).toBeUndefined();
    expect((tok.markers ?? []).map((m) => m.key).sort()).toEqual(["fear", "focus"]);
  });

  it("관전자는 PL 목록에서 다른 관전자를 보지 못하고, GM만 관전자 목록을 받는다", () => {
    const { room, all } = world();
    room.join(spec2);
    expect(room.snapshot(kp).members.filter((m) => m.role === "spectator")).toHaveLength(2);
    expect(room.snapshot(pl1).members.filter((m) => m.role === "spectator")).toHaveLength(0);
    expect(room.snapshot(spec).members.filter((m) => m.role === "spectator").map((m) => m.userId)).toEqual(["sp1"]);
    expect(room.snapshot(spec2).members.filter((m) => m.role === "spectator").map((m) => m.userId)).toEqual(["sp2"]);
    const pres = room.leave("sp2");
    for (const o of pres) {
      const members = (o.event as { data: { members: Array<{ role: string; userId: string }> } }).data.members;
      if (inAudience(o.audience, pl1)) expect(members.some((m) => m.role === "spectator")).toBe(false);
      if (inAudience(o.audience, kp)) expect(members.filter((m) => m.role === "spectator")).toHaveLength(2);
    }
    expect(all.length).toBeGreaterThan(0);
  });
});

/** 모든 명령 종류의 예시. 룸이 실제로 가진 id를 써서, 막히는 이유가 "없는 id"가 아니라 "관전자라서"가 되게 한다. */
const samples = (w: World): Record<string, ClientCommand["data"]> => {
  const { ids } = w;
  const expr = { path: "notes", value: "x" };
  return {
    "object.add": { kind: "token", name: "새", x: 1, y: 1, layer: "object", visibleTo: "all" },
    "object.move": { id: ids.token, x: 5, y: 5, rev: 0 },
    "object.update": { id: ids.token, ownerId: "sp1" },
    "object.marker": { id: ids.token, key: "stun", on: true },
    "member.remove": { userId: "pl2" },
    "member.unban": { userId: "pl2" },
    "board.ping": { sceneId: "main", x: 1, y: 1 },
    "scene.fog": { id: "main", enabled: false },
    "scene.grid": { id: "main", size: 40, show: true, snap: true },
    "fog.reveal": { sceneId: "main", x: 1, y: 1, r: 50 },
    "fog.remove": { sceneId: "main", zoneId: ids.zone },
    "fog.clear": { sceneId: "main" },
    "fog.forget": { sceneId: "main" },
    "object.remove": { id: ids.token },
    "undo.last": {},
    "roll.request": { expr: "1d100", secret: false },
    "roll.ask": { name: "듣기" },
    "character.add": sheet("몰래", 50),
    "handout.create": { title: "x", body: "", visibleTo: "all" },
    "handout.update": { id: ids.handoutPub, body: "바꿈" },
    "handout.remove": { id: ids.handoutPub },
    "handout.show": { id: ids.handoutPub },
    "character.remove": { id: ids.plSheet },
    "sheet.patch": { characterId: ids.plSheet, ops: [expr] },
    "settings.effects": { level: "critical", enabled: false },
    "scene.create": { name: "새 장면" },
    "scene.rename": { id: "main", name: "바꿈" },
    "scene.setStart": { id: "main" },
    "scene.setBgm": { id: "main", trackId: ids.track },
    "scene.background": { id: "main", image: null },
    "scene.remove": { id: ids.scene2 },
    "scene.duplicate": { id: "main" },
    "scene.reorder": { id: "main", index: 0 },
    "scenario.revert": { importId: "none" },
    "scene.activate": { id: ids.scene2, transition: "cut" },
    "damage.roll": { characterId: ids.plSheet, weaponIndex: 0 },
    "damage.apply": { characterId: ids.plSheet, amount: 3, armor: 0 },
    "hp.heal": { characterId: ids.plSheet, kind: "firstAid" },
    "roll.opposed": { a: { characterId: ids.plSheet, name: "심리학" }, b: { characterId: ids.npc, name: "심리학" }, secret: false },
    "roll.group": { name: "심리학", secret: false },
    "roll.push": { rollId: ids.roll },
    "luck.spend": { rollId: ids.roll },
    "san.check": { characterId: ids.plSheet, loss: "0/1" },
    "san.newDay": {},
    "flow.beat.upsert": { name: "새 비트", kind: "progress", memo: "", handoutIds: [] },
    "flow.beat.remove": { id: ids.beat },
    "flow.branch.upsert": { from: ids.beat, to: ids.beat2, label: "분기", condition: { type: "manual" } },
    "flow.branch.remove": { id: ids.branch },
    "flow.goto": { beatId: ids.beat },
    "flow.ending.choose": { beatId: ids.beat2 },
    "flow.dismiss": { branchId: ids.branch },
    "audio.track.add": { label: "x", kind: "se", assetId: "b".repeat(32), volume: 50 },
    "audio.track.remove": { id: ids.track },
    "audio.play": { trackId: ids.track, fadeMs: 0 },
    "audio.stop": { fadeMs: 0 },
    "audio.volume": { volume: 10 },
    "initiative.start": {},
    "initiative.add": { name: "x", dex: 10 },
    "initiative.remove": { id: "x" },
    "initiative.dex": { id: "x", dex: 5 },
    "initiative.next": {},
    "initiative.end": {},
    "settings.madness": { entries: ["x"] },
    "madness.roll": { characterId: ids.plSheet, mode: "realtime" },
    "chat.send": { text: "안녕" },
    "settings.chat": { plWhisper: true, spectatorChat: true },
    "session.start": {},
    "session.pause": {},
    "session.resume": {},
    "session.end": {},
  };
};

const COMMAND_TYPES = clientCommandSchema.options.map((o) => o.shape.type.value as ClientCommand["type"]);

describe("관전자의 명령은 전부 거절된다", () => {
  it("예시가 모든 명령 종류를 덮고, 스키마도 통과한다", () => {
    const w = world();
    const s = samples(w);
    expect(Object.keys(s).sort()).toEqual([...COMMAND_TYPES].sort());
    for (const t of COMMAND_TYPES) {
      const r = clientCommandSchema.safeParse({ type: t, data: s[t] });
      expect(r.success, `${t}: ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  for (const state of ["ACTIVE", "IDLE", "PAUSED"] as const) {
    it(`세션이 ${state}일 때 chat.send 말고는 하나도 통하지 않고, 룸 상태가 바뀌지 않는다`, () => {
      const w = world();
      // world()는 세션을 끝내 둔 상태(IDLE)다.
      if (state !== "IDLE") must(w.room.handle(kp, cmd("session.start", {})));
      if (state === "PAUSED") must(w.room.handle(kp, cmd("session.pause", {})));
      expect(w.room.snapshot(spec).sessionStatus).toBe(state);
      const s = samples(w);
      const before = JSON.stringify(w.room.toData());
      for (const t of COMMAND_TYPES) {
        if (t === "chat.send") continue;
        const r = w.room.handle(spec, { type: t, data: s[t] } as ClientCommand);
        expect(r.ok, `${t}가 관전자에게 통했어요`).toBe(false);
        // 남의 시트는 있다는 사실도 숨기려고 not_found를 돌려주는 명령이 있다. 어느 쪽이든 거절이다.
        if (state === "ACTIVE" && !r.ok) expect(["forbidden", "not_found"], `${t}: ${r.code}`).toContain(r.code);
        if (!r.ok) expect(r.out ?? [], t).toEqual([]);
      }
      expect(JSON.stringify(w.room.toData())).toBe(before);
    });
  }

  it("관전자 대화는 꺼져 있으면 읽기만 되고, 켜도 공개로 말하는 것만 된다", () => {
    const w = world();
    const say = (text: string, extra: Record<string, unknown> = {}) => w.room.handle(spec, cmd("chat.send", { text, ...extra } as never));
    expect(say("안녕")).toMatchObject({ ok: false, code: "forbidden" });
    must(w.room.handle(kp, cmd("session.start", {})));
    must(w.room.handle(kp, cmd("settings.chat", { plWhisper: false, spectatorChat: true })));
    expect(say("구경 중").ok).toBe(true);
    expect(say("/r 1d6")).toMatchObject({ ok: false });
    expect(say("/hr 1d6")).toMatchObject({ ok: false });
    expect(say("/w 서하 비밀", {})).toMatchObject({ ok: false });
    expect(say("귓속", { to: "pl1" })).toMatchObject({ ok: false });
    expect(say("나는 GM", { speaker: { gm: true } })).toMatchObject({ ok: false });
    expect(say("나는 서하", { speaker: { characterId: w.ids.plSheet } })).toMatchObject({ ok: false });
    // 켠 뒤 PL이 설정을 바꾸려 해도 안 된다
    expect(w.room.handle(pl1, cmd("settings.chat", { plWhisper: true, spectatorChat: false }))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("관전자는 토큰 소유자가 될 수 없고, GM의 초대 없이 PL이 되지도 않는다", () => {
    const w = world();
    must(w.room.handle(kp, cmd("session.start", {})));
    expect(w.room.handle(kp, cmd("object.update", { id: w.ids.token, ownerId: "sp1" }))).toMatchObject({ ok: false });
    expect(w.room.roleOf("sp1")).toBe("spectator");
    // 같은 사람이 PL로 다시 들어오려 해도 서버가 가진 역할을 믿는다
    w.room.join({ ...spec, role: "spectator" });
    expect(w.room.handle({ ...spec, role: "pl" }, cmd("roll.request", { expr: "1d6", secret: false }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(w.room.handle({ ...spec, role: "kp" }, cmd("session.pause", {}))).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("GM이 참가자를 내보낸다", () => {
  it("관전자를 내보내면 알림을 받고 목록에서 사라지며, 차단되어 다시 들어올 수 없다", () => {
    const w = world();
    must(w.room.handle(kp, cmd("session.start", {})));
    expect(w.room.handle(pl1, cmd("member.remove", { userId: "sp1" }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(w.room.handle(kp, cmd("member.remove", { userId: "kp1" }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(w.room.handle(kp, cmd("member.remove", { userId: "nobody" }))).toMatchObject({ ok: false, code: "not_found" });
    const out = must(w.room.handle(kp, cmd("member.remove", { userId: "sp1" })));
    const removed = out.filter((o) => o.event.type === "member.removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.audience.users).toEqual(["sp1"]);
    expect(removed[0]!.event.data).toEqual({ banned: true });
    expect(inAudience(removed[0]!.audience, pl1)).toBe(false);
    expect(w.room.roleOf("sp1")).toBeNull();
    expect(w.room.snapshot(kp).members.some((m) => m.userId === "sp1")).toBe(false);
    expect(w.room.isBanned("sp1")).toBe(true);
    // 내보낸 뒤에는 룸 안에서 아무것도 못 한다
    expect(w.room.handle(spec, cmd("chat.send", { text: "나 아직 있나요" }))).toMatchObject({ ok: false, code: "forbidden" });
    // 저장 데이터에는 멤버로 남지 않고 차단 목록에만 남는다
    expect(w.room.toData().members.some((m) => m.userId === "sp1")).toBe(false);
    expect(w.room.toData().banned?.map((b) => b.userId)).toEqual(["sp1"]);
  });

  it("PL도 내보내고 차단할 수 있다. 자기 자신과 GM은 안 된다", () => {
    const w = world();
    must(w.room.handle(kp, cmd("session.start", {})));
    expect(w.room.handle(pl1, cmd("member.remove", { userId: "pl2" }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(w.room.handle(kp, cmd("member.remove", { userId: "kp1" }))).toMatchObject({ ok: false, code: "forbidden" });
    const out = must(w.room.handle(kp, cmd("member.remove", { userId: "pl2" })));
    expect(out.some((o) => o.event.type === "member.removed" && o.audience.users?.[0] === "pl2")).toBe(true);
    expect(w.room.roleOf("pl2")).toBeNull();
    expect(w.room.isBanned("pl2")).toBe(true);
    // 내보낸 PL은 명령을 보낼 수 없다
    expect(w.room.handle(pl2, cmd("roll.request", { expr: "1d6", secret: false }))).toMatchObject({ ok: false, code: "forbidden" });
    // 차단 목록은 GM만 받는다
    expect(w.room.snapshot(kp).banned?.map((b) => b.userId)).toEqual(["pl2"]);
    expect(w.room.snapshot(pl1).banned).toEqual([]);
    expect(w.room.snapshot(spec).banned).toEqual([]);
    const bans = out.find((o) => o.event.type === "bans.updated")!;
    expect(inAudience(bans.audience, kp)).toBe(true);
    expect(inAudience(bans.audience, pl1)).toBe(false);
    // 그 PL의 시트는 룸에 남아 GM이 정리한다
    expect(w.room.snapshot(kp).characters.length).toBeGreaterThan(0);
  });

  it("차단 없이 내보내기(ban:false)는 목록에만 빠진다", () => {
    const w = world();
    must(w.room.handle(kp, cmd("session.start", {})));
    const out = must(w.room.handle(kp, cmd("member.remove", { userId: "pl2", ban: false })));
    expect(out.find((o) => o.event.type === "member.removed")!.event.data).toEqual({});
    expect(w.room.isBanned("pl2")).toBe(false);
    expect(out.some((o) => o.event.type === "bans.updated")).toBe(false);
  });

  it("차단은 GM만 풀 수 있고, 저장하고 다시 열어도 남는다", () => {
    const w = world();
    must(w.room.handle(kp, cmd("session.start", {})));
    must(w.room.handle(kp, cmd("member.remove", { userId: "pl2" })));
    expect(w.room.handle(pl1, cmd("member.unban", { userId: "pl2" }))).toMatchObject({ ok: false, code: "forbidden" });
    expect(w.room.handle(kp, cmd("member.unban", { userId: "nobody" }))).toMatchObject({ ok: false, code: "not_found" });
    const back = Room.fromData(JSON.parse(JSON.stringify(w.room.toData())));
    expect(back.isBanned("pl2")).toBe(true);
    expect(back.snapshot(kp).banned?.[0]).toMatchObject({ userId: "pl2", name: "도윤" });
    must(w.room.handle(kp, cmd("member.unban", { userId: "pl2" })));
    expect(w.room.isBanned("pl2")).toBe(false);
    expect(w.room.snapshot(kp).banned).toEqual([]);
  });

  it("옛 저장 데이터(차단 목록 없음)도 그대로 열린다", () => {
    const w = world();
    const data = JSON.parse(JSON.stringify(w.room.toData()));
    delete data.banned;
    data.schemaVersion = 3;
    expect(Room.fromData(data).snapshot(kp).banned).toEqual([]);
  });
});

/** GM만 쓸 수 있는 명령. PL이 보내면 룸이 바뀌지 않고 거절돼야 한다. */
const GM_ONLY = [
  "member.remove", "member.unban", "object.add", "object.update", "object.remove", "hp.heal", "roll.group", "scenario.revert", "scene.fog", "scene.grid", "fog.reveal", "fog.remove", "fog.clear", "fog.forget",
  "undo.last", "roll.ask", "handout.create", "handout.update", "handout.remove", "handout.show", "settings.effects",
  "scene.create", "scene.rename", "scene.setStart", "scene.setBgm", "scene.background", "scene.remove", "scene.duplicate",
  "scene.reorder", "scene.activate", "damage.apply", "san.newDay", "flow.beat.upsert", "flow.beat.remove", "flow.branch.upsert",
  "flow.branch.remove", "flow.goto", "flow.ending.choose", "flow.dismiss", "audio.track.add", "audio.track.remove", "audio.play",
  "audio.stop", "audio.volume", "initiative.start", "initiative.add", "initiative.remove", "initiative.dex", "initiative.next",
  "initiative.end", "settings.madness", "madness.roll", "settings.chat", "session.start", "session.pause", "session.resume", "session.end",
] as const;

describe("PL의 GM 전용 명령은 거절된다", () => {
  for (const state of ["ACTIVE", "IDLE", "PAUSED"] as const) {
    it(`세션이 ${state}일 때 GM 전용 ${GM_ONLY.length}개가 하나도 통하지 않고 룸이 그대로다`, () => {
      const w = world();
      if (state !== "IDLE") must(w.room.handle(kp, cmd("session.start", {})));
      if (state === "PAUSED") must(w.room.handle(kp, cmd("session.pause", {})));
      const s = samples(w);
      const before = JSON.stringify(w.room.toData());
      for (const t of GM_ONLY) {
        const r = w.room.handle(pl2, { type: t, data: s[t] } as ClientCommand);
        expect(r.ok, `${t}가 PL에게 통했어요`).toBe(false);
        if (!r.ok) expect(r.out ?? [], t).toEqual([]);
      }
      expect(JSON.stringify(w.room.toData())).toBe(before);
    });
  }
});

/** 레벨 3: PL이 쓸 수 있는 명령(나머지는 전부 GM 전용이어야 한다). 새 명령을 프로토콜에 더하면 둘 중 한 곳에 반드시 넣어야 이 시험이 통과한다. */
const PL_ALLOWED = [
  "object.move", "object.marker", "board.ping", "character.add", "character.remove", "sheet.patch", "damage.roll",
  "roll.request", "roll.opposed", "roll.push", "luck.spend", "san.check", "chat.send",
] as const;

describe("권한 분류표가 모든 명령을 덮는다 (새 명령이 분류 없이 끼어들 수 없다)", () => {
  it("프로토콜의 모든 명령은 GM_ONLY 또는 PL_ALLOWED 중 정확히 한 곳에 있다", () => {
    const gm = new Set<string>(GM_ONLY);
    const pl = new Set<string>(PL_ALLOWED);
    const unclassified = COMMAND_TYPES.filter((t) => !gm.has(t) && !pl.has(t));
    expect(unclassified, `분류되지 않은 명령: ${unclassified.join(", ")} — spectator.test.ts의 GM_ONLY나 PL_ALLOWED에 넣고 권한 시험을 확인하세요`).toEqual([]);
    const both = COMMAND_TYPES.filter((t) => gm.has(t) && pl.has(t));
    expect(both, `두 목록에 모두 있는 명령: ${both.join(", ")}`).toEqual([]);
    const unknown = [...gm, ...pl].filter((t) => !(COMMAND_TYPES as string[]).includes(t));
    expect(unknown, `프로토콜에 없는 명령: ${unknown.join(", ")}`).toEqual([]);
    expect(gm.size).toBe(GM_ONLY.length); // 목록 안 중복 없음
  });
});
