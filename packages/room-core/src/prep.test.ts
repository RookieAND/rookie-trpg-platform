import { describe, expect, it } from "vitest";
import { defaultSkillValues, parseScenarioText, type ClientCommand, type GameObject, type ScenarioDoc } from "@coc-vtt/shared";
import { Room, inAudience, type Actor, type Out } from "./room";
import { buildExport } from "./export";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl1: Actor = { userId: "pl1", name: "서하", role: "pl" };
const pl2: Actor = { userId: "pl2", name: "도윤", role: "pl" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const to = (outs: Out[], a: Actor) => outs.filter((o) => inAudience(o.audience, a)).map((o) => o.event);
const IMG = "a".repeat(32);

const sheet = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  age: 30,
  occupation: "",
  characteristics: { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 },
  skills: [],
  notes: "",
  backstory: "",
  possessions: "",
  weapons: [],
  ...extra,
});

/** 기본 기능이 모두 채워진 시트(실제 룸의 시트처럼) */
const full = (name: string, extra: Record<string, unknown> = {}) => {
  const base = sheet(name, extra);
  return { ...base, skills: defaultSkillValues(base).map((sk) => ({ ...sk, grown: false })) };
};

const setup = () => {
  const room = new Room("r", { newId: () => `id-${++n}`, rng: () => 0.5 });
  for (const a of [kp, pl1, pl2]) room.join(a);
  must(room.handle(kp, cmd("session.start", {})));
  return room;
};
const idOf = (outs: Out[], type: "scene.added" | "object.added" | "character.added" | "handout.added") =>
  (outs.find((o) => o.event.type === type)!.event as { data: { id: string } }).data.id;

const doc = (over: Partial<ScenarioDoc> = {}): ScenarioDoc => {
  const r = parseScenarioText(
    JSON.stringify({
      format: "roll-and-call-scenario",
      version: 2,
      roomName: "시험",
      scenes: [{ key: "s1", name: "현관", start: true }, { key: "s2", name: "지하실" }],
      tokens: [{ scene: "s1", kind: "token", name: "관리인", x: 100, y: 100, character: "c1", owner: "PL1" }, { scene: "s2", kind: "prop", name: "상자", x: 5, y: 6 }],
      characters: [{ key: "c1", name: "관리인", age: 50, characteristics: { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 }, weapons: [{ name: "곤봉", skill: "맨손 격투", damage: "1d6" }] }],
      handouts: [{ key: "h1", title: "쪽지", body: "...", visibleTo: "all" }, { key: "h2", title: "개인 편지", to: ["서하"] }, { key: "h3", title: "[KP] 비밀", visibleTo: "gm" }],
      beats: [{ key: "b1", name: "도착", kind: "start", scene: "s1", handouts: ["h1"] }, { key: "b2", name: "끝", kind: "ending" }],
      branches: [{ from: "b1", to: "b2", label: "간다" }],
    }),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return { ...r.doc, ...over };
};

describe("장면 복제", () => {
  it("오브젝트·안개·배경·배경음을 복사하고 이름에 '복사'를 붙여 원본 바로 뒤에 놓는다", () => {
    const room = setup();
    must(room.handle(kp, cmd("audio.track.add", { label: "곡", kind: "bgm", assetId: IMG, volume: 50 })));
    const trackId = room.snapshot(kp).audioLibrary[0]!.id;
    const second = idOf(must(room.handle(kp, cmd("scene.create", { name: "서재" }))), "scene.added");
    must(room.handle(kp, cmd("scene.background", { id: "main", image: IMG })));
    must(room.handle(kp, cmd("scene.setBgm", { id: "main", trackId })));
    must(room.handle(kp, cmd("scene.setStart", { id: "main" })));
    must(room.handle(kp, cmd("fog.reveal", { sceneId: "main", x: 100, y: 100, r: 80 })));
    must(room.handle(kp, cmd("scene.fog", { id: "main", enabled: true })));
    const tok = idOf(must(room.handle(kp, cmd("object.add", { kind: "token", name: "서하", x: 10, y: 20, layer: "object", visibleTo: "all", ownerId: "pl1" }))), "object.added");

    const outs = must(room.handle(kp, cmd("scene.duplicate", { id: "main" })));
    const snap = room.snapshot(kp);
    expect(snap.scenes.map((s) => s.name)).toEqual(["장면 1", "장면 1 복사", "서재"]);
    const copy = snap.scenes[1]!;
    expect(copy.id).not.toBe("main");
    expect(copy).toMatchObject({ background: IMG, bgmTrackId: trackId, fog: { enabled: true } });
    expect(copy.start).toBeUndefined();
    expect(copy.fog!.zones).toHaveLength(1);
    expect(copy.fog!.zones[0]!.id).not.toBe(snap.scenes[0]!.fog!.zones[0]!.id);
    const dup = snap.objects.find((o) => o.sceneId === copy.id)!;
    expect(dup).toMatchObject({ name: "서하", ownerId: "pl1", x: 10, y: 20, rev: 0 });
    expect(dup.id).not.toBe(tok);
    expect(second).toBeTruthy();
    // 복사한 장면은 활성이 아니라 PL에게 아무것도 알리지 않는다
    expect(to(outs, pl1)).toEqual([]);
    expect(to(outs, kp).some((e) => e.type === "scene.order")).toBe(true);
    // 다시 복제하면 번호가 붙는다
    must(room.handle(kp, cmd("scene.duplicate", { id: "main" })));
    expect(room.snapshot(kp).scenes.map((s) => s.name)).toContain("장면 1 복사 2");
  });

  it("GM만 할 수 있고 장면 수 한도를 넘지 않는다", () => {
    const room = setup();
    expect(room.handle(pl1, cmd("scene.duplicate", { id: "main" })).ok).toBe(false);
    for (let i = 0; i < 29; i++) must(room.handle(kp, cmd("scene.create", { name: `장면 ${i + 2}` })));
    const r = room.handle(kp, cmd("scene.duplicate", { id: "main" }));
    expect(r.ok).toBe(false);
    expect(room.snapshot(kp).scenes).toHaveLength(30);
  });
});

describe("장면 순서", () => {
  it("옮긴 순서가 snapshot과 저장 데이터에 남고 GM에게만 알린다", () => {
    const room = setup();
    const b = idOf(must(room.handle(kp, cmd("scene.create", { name: "B" }))), "scene.added");
    const c = idOf(must(room.handle(kp, cmd("scene.create", { name: "C" }))), "scene.added");
    const outs = must(room.handle(kp, cmd("scene.reorder", { id: c, index: 0 })));
    expect(room.snapshot(kp).scenes.map((s) => s.name)).toEqual(["C", "장면 1", "B"]);
    expect(to(outs, pl1)).toEqual([]);
    expect(to(outs, kp)).toEqual([{ type: "scene.order", data: { ids: [c, "main", b] } }]);
    expect(Room.fromData(room.toData()).snapshot(kp).scenes.map((s) => s.name)).toEqual(["C", "장면 1", "B"]);
    expect(room.handle(pl1, cmd("scene.reorder", { id: b, index: 0 })).ok).toBe(false);
    expect(room.handle(kp, cmd("scene.reorder", { id: "nope", index: 0 })).ok).toBe(false);
  });
});

describe("장면 전환 때 PL 토큰 자리", () => {
  it("새 장면에 토큰이 없으면 이전 장면에서 서 있던 자리와 같은 자리에 놓이고, 돌아오면 마지막 자리가 그대로다", () => {
    const room = setup();
    const next = idOf(must(room.handle(kp, cmd("scene.create", { name: "지하실" }))), "scene.added");
    const t = idOf(must(room.handle(kp, cmd("object.add", { kind: "token", name: "서하", x: 200, y: 640, layer: "object", visibleTo: "all", ownerId: "pl1" }))), "object.added");
    must(room.handle(kp, cmd("scene.activate", { id: next, transition: "cut" })));
    const there = room.snapshot(pl1).objects.find((o) => o.ownerId === "pl1")!;
    expect([there.sceneId, there.x, there.y]).toEqual([next, 200, 640]);
    // 지하실에서 움직이고 되돌아가면 현관 토큰은 마지막 자리 그대로다
    must(room.handle(pl1, cmd("object.move", { id: there.id, x: 700, y: 100, rev: there.rev })));
    must(room.handle(kp, cmd("scene.activate", { id: "main", transition: "cut" })));
    expect(room.snapshot(pl1).objects.find((o) => o.id === t)).toMatchObject({ x: 200, y: 640 });
    must(room.handle(kp, cmd("scene.activate", { id: next, transition: "cut" })));
    expect(room.snapshot(pl1).objects.find((o) => o.id === there.id)).toMatchObject({ x: 700, y: 100 });
  });
});

describe("토큰과 시트 연결", () => {
  const withSheets = () => {
    const room = setup();
    must(room.handle(pl1, cmd("character.add", sheet("윤서하"))));
    must(room.handle(pl2, cmd("character.add", sheet("한도윤"))));
    const npc = idOf(must(room.handle(kp, cmd("character.add", sheet("교단원")))), "character.added");
    const mine = room.snapshot(pl1).characters[0]!.id;
    const theirs = room.snapshot(pl2).characters[0]!.id;
    const add = (name: string, characterId: string, extra: Record<string, unknown> = {}) =>
      must(room.handle(kp, cmd("object.add", { kind: "token", name, x: 1, y: 1, layer: "object", visibleTo: "all", characterId, ...extra } as never)));
    return { room, npc, mine, theirs, add };
  };
  const tokenOf = (room: Room, who: Actor, name: string) => room.snapshot(who).objects.find((o) => o.name === name) as GameObject | undefined;

  it("GM은 연결과 HP 요약을 받고, NPC 시트의 id·HP는 PL에게 가지 않는다", () => {
    const { room, npc, add } = withSheets();
    const outs = add("교단원", npc);
    expect(JSON.stringify(to(outs, pl1))).not.toContain(npc);
    expect(JSON.stringify(to(outs, pl1))).not.toContain("vitals");
    const gm = tokenOf(room, kp, "교단원")!;
    expect(gm.characterId).toBe(npc);
    expect(gm.vitals).toMatchObject({ hp: 10, max: 10 });
    const pl = tokenOf(room, pl1, "교단원")!;
    expect(pl.characterId).toBeUndefined();
    expect(pl.vitals).toBeUndefined();
    expect(pl.hpPublic).toBeUndefined();
    expect(JSON.stringify(room.snapshot(pl1))).not.toContain(npc);
  });

  it("PC 토큰은 모든 PL이 HP 요약을 보지만 시트 id는 주인만 받는다", () => {
    const { room, mine, add } = withSheets();
    add("서하", mine, { ownerId: "pl1" });
    expect(tokenOf(room, pl1, "서하")!.characterId).toBe(mine);
    expect(tokenOf(room, pl1, "서하")!.vitals).toMatchObject({ hp: 10, max: 10 });
    const other = tokenOf(room, pl2, "서하")!;
    expect(other.characterId).toBeUndefined();
    expect(other.vitals).toMatchObject({ hp: 10, max: 10 });
  });

  it("GM이 'HP 공개'를 켜야 PL이 NPC 토큰의 HP를 보고, 그래도 시트 id는 받지 않는다", () => {
    const { room, npc, add } = withSheets();
    const id = idOf(add("교단원", npc), "object.added");
    const outs = must(room.handle(kp, cmd("object.update", { id, hpPublic: true })));
    expect(to(outs, pl1)).toHaveLength(1);
    const pl = tokenOf(room, pl1, "교단원")!;
    expect(pl.vitals).toMatchObject({ hp: 10 });
    expect(pl.characterId).toBeUndefined();
    expect(JSON.stringify(to(outs, pl1))).not.toContain(npc);
    must(room.handle(kp, cmd("object.update", { id, hpPublic: false })));
    expect(tokenOf(room, pl1, "교단원")!.vitals).toBeUndefined();
  });

  it("피해·직접 수정으로 HP가 바뀌면 이어진 토큰이 보이는 사람에게 새 요약을 받는다", () => {
    const { room, npc, mine, add } = withSheets();
    add("서하", mine, { ownerId: "pl1" });
    const nid = idOf(add("교단원", npc, { hpPublic: true }), "object.added");
    const dmg = must(room.handle(kp, cmd("damage.apply", { characterId: mine, amount: 3, armor: 0 })));
    const upd = to(dmg, pl2).filter((e) => e.type === "object.updated") as Array<{ data: GameObject }>;
    expect(upd).toHaveLength(1);
    expect(upd[0]!.data).toMatchObject({ name: "서하", vitals: { hp: 7, max: 10 } });
    const patch = must(room.handle(kp, cmd("sheet.patch", { characterId: npc, ops: [{ path: "hp", delta: -4 }] })));
    expect((to(patch, pl2).find((e) => e.type === "object.updated") as { data: GameObject }).data).toMatchObject({ id: nid, vitals: { hp: 6 } });
    expect(JSON.stringify(to(patch, pl2))).not.toContain(npc);
    // 상태 칩: 중상(피해 5 이상)
    const big = must(room.handle(kp, cmd("damage.apply", { characterId: mine, amount: 5, armor: 0 })));
    expect(JSON.stringify(to(big, pl1))).toContain("majorWound");
    // HP가 달라지지 않는 시트 수정은 토큰을 다시 보내지 않는다
    const note = must(room.handle(pl1, cmd("sheet.patch", { characterId: mine, ops: [{ path: "notes", value: "메모" }] })));
    expect(to(note, pl2).filter((e) => e.type === "object.updated")).toEqual([]);
  });

  it("없는 시트에는 이을 수 없고, 시트를 지우면 연결이 풀린다(되돌려도 풀린 채)", () => {
    const { room, npc, add } = withSheets();
    expect(room.handle(kp, cmd("object.add", { kind: "token", name: "X", x: 1, y: 1, layer: "object", visibleTo: "all", characterId: "none" })).ok).toBe(false);
    const id = idOf(add("교단원", npc), "object.added");
    expect(room.handle(kp, cmd("object.update", { id, characterId: "none" })).ok).toBe(false);
    const outs = must(room.handle(kp, cmd("character.remove", { id: npc })));
    expect(to(outs, kp).some((e) => e.type === "object.updated")).toBe(true);
    expect(tokenOf(room, kp, "교단원")!.characterId).toBeUndefined();
    // 토큰을 지웠다가 시트를 지운 뒤 되돌려도 없는 시트를 가리키지 않는다
    const again = withSheets();
    const nid = idOf(again.add("교단원", again.npc), "object.added");
    must(again.room.handle(kp, cmd("object.remove", { id: nid })));
    must(again.room.handle(kp, cmd("character.remove", { id: again.npc })));
    must(again.room.handle(kp, cmd("undo.last", {})));
    expect(tokenOf(again.room, kp, "교단원")).toBeDefined();
    expect(tokenOf(again.room, kp, "교단원")!.characterId).toBeUndefined();
  });

  it("연결을 풀 수 있고, 저장했다 불러와도 연결이 남으며 PL은 여전히 NPC 정보를 못 받는다", () => {
    const { room, npc, add } = withSheets();
    const id = idOf(add("교단원", npc), "object.added");
    const again = Room.fromData(JSON.parse(JSON.stringify(room.toData())));
    again.join(kp);
    again.join(pl1);
    expect(tokenOf(again, kp, "교단원")!.characterId).toBe(npc);
    expect(JSON.stringify(again.snapshot(pl1))).not.toContain(npc);
    must(room.handle(kp, cmd("object.update", { id, characterId: null })));
    expect(tokenOf(room, kp, "교단원")!.characterId).toBeUndefined();
    expect(tokenOf(room, kp, "교단원")!.vitals).toBeUndefined();
  });

  it("장면을 옮겨 따라온 PL 토큰도 시트 연결을 이어받는다", () => {
    const { room, mine, add } = withSheets();
    add("서하", mine, { ownerId: "pl1" });
    const next = idOf(must(room.handle(kp, cmd("scene.create", { name: "다음" }))), "scene.added");
    must(room.handle(kp, cmd("scene.activate", { id: next, transition: "cut" })));
    expect(room.snapshot(pl1).objects.find((o) => o.ownerId === "pl1")).toMatchObject({ characterId: mine, sceneId: next });
  });
});

describe("룸 안 NPC 시트 권한", () => {
  it("GM이 만든 NPC 시트는 PL이 받지 못하고 고치지 못하며, 무기·기능은 GM만 고친다", () => {
    const room = setup();
    const npc = idOf(must(room.handle(kp, cmd("character.add", sheet("교단원", { weapons: [{ name: "단검", skill: "맨손 격투", damage: "1d4+db" }] })))), "character.added");
    expect(room.snapshot(pl1).characters).toEqual([]);
    expect(room.handle(pl1, cmd("sheet.patch", { characterId: npc, ops: [{ path: "hp", value: 1 }] })).ok).toBe(false);
    must(room.handle(kp, cmd("sheet.patch", { characterId: npc, ops: [{ path: "weapons", value: [{ name: "도끼", skill: "맨손 격투", damage: "1d8+2" }] }, { path: "skill", name: "은밀", value: 55 }] })));
    expect(room.snapshot(kp).characters.find((c) => c.id === npc)).toMatchObject({ weapons: [{ name: "도끼" }], skills: { 은밀: { value: 55 } } });
    // PL이 남의 몫(NPC)으로 시트를 만들 수 없다
    expect(room.handle(pl1, cmd("character.add", { ...sheet("가짜"), ownerId: "kp1" } as never)).ok).toBe(false);
  });

  it("NPC 시트에도 피해가 적용되고 HP가 줄어든다", () => {
    const room = setup();
    const npc = idOf(must(room.handle(kp, cmd("character.add", sheet("교단원")))), "character.added");
    must(room.handle(kp, cmd("damage.apply", { characterId: npc, amount: 4, armor: 1 })));
    expect(room.snapshot(kp).characters.find((c) => c.id === npc)!.hp).toBe(7);
  });
});

describe("시나리오 가져오기", () => {
  const stats = (room: Room) => {
    const s = room.snapshot(kp);
    return { scenes: s.scenes.length, objects: s.objects.length, chars: s.characters.length, handouts: s.handouts.length, beats: s.flow!.beats.length };
  };

  it("전부 새 id로 들어가고 키·참조가 이어지며, 비어 있던 첫 장면을 재활용한다", () => {
    const room = setup();
    const r = room.importScenario("kp1", doc());
    if (!r.ok) throw new Error(r.message);
    const snap = room.snapshot(kp);
    expect(snap.scenes.map((s) => s.name)).toEqual(["현관", "지하실"]);
    expect(snap.scenes[0]!.id).toBe("main"); // 재활용
    expect(snap.scenes[0]!.start).toBe(true);
    const ids = [...snap.scenes.map((s) => s.id), ...snap.objects.map((o) => o.id), ...snap.characters.map((c) => c.id), ...snap.handouts.map((h) => h.id), ...snap.flow!.beats.map((b) => b.id)];
    expect(ids.some((i) => ["s1", "s2", "c1", "h1", "b1"].includes(i))).toBe(false);
    expect(new Set(ids).size).toBe(ids.length);
    const warden = snap.objects.find((o) => o.name === "관리인")!;
    expect(warden).toMatchObject({ ownerId: "pl1", characterId: snap.characters[0]!.id });
    expect(snap.characters[0]).toMatchObject({ ownerId: "kp1", weapons: [{ name: "곤봉" }] });
    expect(snap.characters[0]!.skills["회피"]).toBeDefined(); // 기본 기능이 채워진다
    expect(snap.handouts.find((h) => h.title === "개인 편지")!.visibleTo).toEqual(["pl1"]);
    const secret = snap.handouts.find((h) => h.title === "비밀")!;
    expect(secret).toMatchObject({ kpOnly: true, visibleTo: "gm" });
    expect(snap.flow!.beats[0]!.handoutIds).toEqual([snap.handouts.find((h) => h.title === "쪽지")!.id]);
    expect(snap.flow!.branches[0]).toMatchObject({ from: snap.flow!.beats[0]!.id, to: snap.flow!.beats[1]!.id });
    // PL은 자기 몫의 핸드아웃만 받고 비밀은 못 받는다
    expect(room.snapshot(pl1).handouts.map((h) => h.title).sort()).toEqual(["개인 편지", "쪽지"]);
    expect(room.snapshot(pl2).handouts.map((h) => h.title)).toEqual(["쪽지"]);
    expect(JSON.stringify(room.snapshot(pl1))).not.toContain(snap.characters[0]!.id);
  });

  it("한도를 넘으면 아무것도 바뀌지 않는다(전부 또는 아무것도)", () => {
    const room = setup();
    for (let i = 0; i < 28; i++) must(room.handle(kp, cmd("scene.create", { name: `장면 ${i + 2}` })));
    const before = JSON.stringify(room.toData());
    const seq = room.currentSeq;
    const r = room.importScenario("kp1", doc());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("장면");
    expect(JSON.stringify(room.toData())).toBe(before);
    expect(room.currentSeq).toBe(seq);
  });

  it("검사만 하면(dryRun) 룸이 그대로이고 같은 개수·경고를 알려 준다", () => {
    const room = setup();
    const before = JSON.stringify(room.toData());
    const r = room.importScenario("kp1", doc(), { dryRun: true });
    if (!r.ok) throw new Error(r.message);
    expect(r.report.counts).toMatchObject({ scenes: 2, tokens: 2, characters: 1, handouts: 3 });
    expect(JSON.stringify(room.toData())).toBe(before);
  });

  it("못 찾은 소유자·공개 대상은 경고하고 NPC·GM 전용으로 둔다", () => {
    const room = new Room("r", { newId: () => `id-${++n}` });
    room.join(kp);
    const r = room.importScenario("kp1", doc());
    if (!r.ok) throw new Error(r.message);
    expect(r.report.warnings.join("\n")).toContain("소유자 'PL1'을 찾지 못해");
    expect(r.report.warnings.join("\n")).toContain("공개 대상 '서하'를 찾지 못했어요");
    const snap = room.snapshot(kp);
    expect(snap.objects.find((o) => o.name === "관리인")!.ownerId).toBeUndefined();
    expect(snap.handouts.find((h) => h.title === "개인 편지")!.visibleTo).toBe("gm");
  });

  it("GM이 아니면 가져올 수 없다", () => {
    const room = setup();
    expect(room.importScenario("pl1", doc()).ok).toBe(false);
    expect(room.importScenario("누군가", doc()).ok).toBe(false);
  });

  it("쓸 수 없는 이미지·음원은 건너뛰고 경고한다", () => {
    const room = setup();
    const d = doc();
    d.scenes[0]!.background = "data:image/png;base64,AAAA";
    d.audio = [{ key: "a1", label: "곡", kind: "bgm", file: "x.mp3" }, { key: "a2", label: "좋은 곡", kind: "bgm", assetId: IMG }];
    d.scenes[1]!.bgm = "a1";
    const r = room.importScenario("kp1", d);
    if (!r.ok) throw new Error(r.message);
    expect(r.report.warnings.join("\n")).toContain("이미지 1개");
    expect(r.report.warnings.join("\n")).toContain("음원 '곡'은 파일이 없어서");
    const snap = room.snapshot(kp);
    expect(snap.audioLibrary.map((t) => t.label)).toEqual(["좋은 곡"]);
    expect(snap.scenes[0]!.background).toBeUndefined();
  });

  it("되돌리기는 가져온 것을 모두 지우고 첫 장면을 원래대로 돌린다", () => {
    const room = setup();
    const before = stats(room);
    const mid = JSON.stringify(room.snapshot(kp).scenes);
    const r = room.importScenario("kp1", doc());
    if (!r.ok) throw new Error(r.message);
    expect(stats(room)).not.toEqual(before);
    expect(room.handle(kp, cmd("scenario.revert", { importId: "다른 번호" })).ok).toBe(false);
    expect(room.handle(pl1, cmd("scenario.revert", { importId: r.report.importId })).ok).toBe(false);
    must(room.handle(kp, cmd("scenario.revert", { importId: r.report.importId })));
    expect(stats(room)).toEqual(before);
    expect(JSON.stringify(room.snapshot(kp).scenes)).toBe(mid);
    expect(room.handle(kp, cmd("scenario.revert", { importId: r.report.importId })).ok).toBe(false);
  });

  it("가져온 장면이 진행 중이면 되돌릴 수 없다", () => {
    const room = setup();
    must(room.handle(kp, cmd("scene.create", { name: "기존" }))); // 첫 장면 재활용이 일어나지 않게
    const r = room.importScenario("kp1", doc());
    if (!r.ok) throw new Error(r.message);
    const hall = room.snapshot(kp).scenes.find((s) => s.name === "현관")!;
    must(room.handle(kp, cmd("scene.activate", { id: hall.id, transition: "cut" })));
    expect(room.handle(kp, cmd("scenario.revert", { importId: r.report.importId })).ok).toBe(false);
  });

  it("시작 장면·시작 비트가 이미 있으면 가져온 것은 시작으로 정하지 않는다", () => {
    const room = setup();
    must(room.handle(kp, cmd("scene.setStart", { id: "main" })));
    must(room.handle(kp, cmd("flow.beat.upsert", { name: "기존 시작", kind: "start", memo: "", handoutIds: [] })));
    const r = room.importScenario("kp1", doc());
    if (!r.ok) throw new Error(r.message);
    expect(r.report.warnings.join("\n")).toContain("시작 장면");
    expect(r.report.warnings.join("\n")).toContain("시작 비트");
    expect(room.snapshot(kp).scenes.filter((s) => s.start)).toHaveLength(1);
    expect(room.snapshot(kp).flow!.beats.filter((b) => b.kind === "start")).toHaveLength(1);
  });
});

describe("백업 왕복", () => {
  it("내보낸 문서를 JSON으로 거쳐 새 룸에 가져오면 같은 모양이 되고 비밀·사람 정보는 담기지 않는다", () => {
    const room = setup();
    const s2 = idOf(must(room.handle(kp, cmd("scene.create", { name: "지하실" }))), "scene.added");
    must(room.handle(kp, cmd("scene.setStart", { id: "main" })));
    must(room.handle(kp, cmd("scene.background", { id: "main", image: IMG })));
    must(room.handle(kp, cmd("audio.track.add", { label: "곡", kind: "bgm", assetId: "b".repeat(32), volume: 40 })));
    must(room.handle(kp, cmd("scene.setBgm", { id: s2, trackId: room.snapshot(kp).audioLibrary[0]!.id })));
    must(room.handle(kp, cmd("scene.fog", { id: s2, enabled: true })));
    must(room.handle(kp, cmd("fog.reveal", { sceneId: s2, x: 50, y: 60, r: 100 })));
    must(room.handle(pl1, cmd("character.add", full("윤서하"))));
    const npc = idOf(must(room.handle(kp, cmd("character.add", full("교단원", { weapons: [{ name: "단검", skill: "맨손 격투", damage: "1d4+db" }], luck: 33 })))), "character.added");
    must(room.handle(kp, cmd("object.add", { kind: "token", name: "윤서하", x: 10, y: 10, layer: "object", visibleTo: "all", ownerId: "pl1" })));
    must(room.handle(kp, cmd("object.add", { kind: "token", name: "교단원", x: 30, y: 40, layer: "object", visibleTo: "all", characterId: npc, hpPublic: true, image: IMG })));
    must(room.handle(kp, cmd("object.add", { kind: "prop", name: "비밀 상자", x: 3, y: 4, layer: "gm", visibleTo: "gm", sceneId: s2 })));
    must(room.handle(kp, cmd("handout.create", { title: "편지", body: "본문", visibleTo: ["pl1"] })));
    must(room.handle(kp, cmd("handout.create", { title: "GM 메모", body: "비밀", visibleTo: "gm", kpOnly: true })));
    must(room.handle(kp, cmd("settings.madness", { entries: ["도망", "기절"] })));
    must(room.handle(kp, cmd("settings.effects", { level: "hard", enabled: true })));
    must(room.handle(kp, cmd("flow.beat.upsert", { name: "시작", kind: "start", memo: "m", handoutIds: [room.snapshot(kp).handouts[0]!.id], sceneId: s2 })));
    must(room.handle(kp, cmd("flow.beat.upsert", { name: "끝", kind: "ending", memo: "", handoutIds: [], sanReward: "1d3" })));
    const beats = room.snapshot(kp).flow!.beats;
    must(room.handle(kp, cmd("flow.branch.upsert", { from: beats[0]!.id, to: beats[1]!.id, label: "간다", condition: { type: "stat", stat: "san", atMost: 10 } })));

    const out = buildExport(room.toData(), { format: "backup", sheets: true, roomName: "원본", exportedAt: "2026-10-19T00:00:00Z" });
    const text = JSON.stringify(out);
    // 사용자 id·이름과 룸 id는 담기지 않는다(PL은 캐릭터 이름으로만 나온다)
    for (const secret of ["kp1", "pl1", "pl2", "하늘", "도윤", "id-"]) expect(text).not.toContain(secret);
    expect(text).toContain("윤서하");
    const parsed = parseScenarioText(text);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

    const copy = new Room("copy", { newId: () => `c-${++n}` });
    const r = copy.importScenario(null, parsed.doc, { newRoom: true, ownerId: "owner" });
    if (!r.ok) throw new Error(r.message);
    copy.join({ userId: "owner", name: "주인", role: "kp" });
    const a = room.snapshot(kp);
    const b = copy.snapshot({ userId: "owner", role: "kp" });
    const norm = (s: typeof a) => ({
      scenes: s.scenes.map((x) => ({ name: x.name, start: x.start, background: x.background, zones: x.fog?.zones.map(({ x: px, y, r: pr }) => [px, y, pr]), fog: x.fog?.enabled, bgm: x.bgmTrackId ? s.audioLibrary.find((t) => t.id === x.bgmTrackId)!.label : undefined })),
      objects: s.objects.map((o) => ({ name: o.name, scene: s.scenes.find((x) => x.id === o.sceneId)!.name, x: o.x, y: o.y, layer: o.layer, image: o.image, linked: s.characters.find((c) => c.id === o.characterId)?.name, hpPublic: o.hpPublic })),
      chars: s.characters.map((c) => ({ name: c.name, weapons: c.weapons, luck: c.luck, skills: c.skills, hp: c.hp })),
      handouts: s.handouts.map((h) => ({ title: h.title, body: h.body, kpOnly: h.kpOnly, all: h.visibleTo === "all", gm: h.visibleTo === "gm" })),
      beats: s.flow!.beats.map((x) => ({ name: x.name, kind: x.kind, memo: x.memo, sanReward: x.sanReward, scene: s.scenes.find((sc) => sc.id === x.sceneId)?.name, handouts: x.handoutIds.length })),
      branches: s.flow!.branches.map((x) => ({ label: x.label, condition: x.condition })),
      madness: s.madnessTable,
      effects: s.effects,
      audio: s.audioLibrary.map((t) => [t.label, t.assetId, t.volume]),
    });
    const na = norm(a);
    const nb = norm(b);
    // 소유자가 있던 토큰은 새 룸에 PL이 없어 소유자 없이 들어오고, 개인 편지는 GM 전용이 된다. 나머지는 같다.
    expect(nb).toEqual({ ...na, handouts: na.handouts.map((h) => (h.title === "편지" ? { ...h, all: false, gm: true } : h)) });
    expect(b.characters.map((c) => c.ownerId)).toEqual(["owner", "owner"]); // PC 시트는 GM 몫
    expect(b.objects.find((o) => o.name === "윤서하")!.ownerId).toBeUndefined();
    expect(b.handouts.find((h) => h.title === "GM 메모")).toMatchObject({ kpOnly: true, visibleTo: "gm" });
    // 새 룸의 id는 원본과 하나도 겹치지 않는다
    const idsA = new Set([...a.objects.map((o) => o.id), ...a.characters.map((c) => c.id), ...a.handouts.map((h) => h.id), ...a.scenes.map((s) => s.id).filter((i) => i !== "main")]);
    for (const o of b.objects) expect(idsA.has(o.id)).toBe(false);
  });

  it("시트 포함을 끄면 시트와 연결이 빠진다", () => {
    const room = setup();
    const npc = idOf(must(room.handle(kp, cmd("character.add", sheet("교단원")))), "character.added");
    must(room.handle(kp, cmd("object.add", { kind: "token", name: "교단원", x: 1, y: 1, layer: "object", visibleTo: "all", characterId: npc })));
    const out = buildExport(room.toData(), { format: "scenario", sheets: false, roomName: "x", exportedAt: "t" });
    expect(out.characters).toEqual([]);
    expect(out.tokens[0]!.character).toBeUndefined();
    expect(out.effects).toBeUndefined();
  });

  it("PL 순번(PL1)으로도 소유자를 다시 맞춘다", () => {
    const room = setup();
    must(room.handle(kp, cmd("object.add", { kind: "token", name: "토큰", x: 1, y: 1, layer: "object", visibleTo: "all", ownerId: "pl2" })));
    const out = buildExport(room.toData(), { format: "backup", sheets: true, roomName: "x", exportedAt: "t" });
    expect(out.tokens[0]!.owner).toBe("PL2");
    const fresh = setup();
    const r = fresh.importScenario("kp1", out);
    if (!r.ok) throw new Error(r.message);
    expect(fresh.snapshot(kp).objects.find((o) => o.name === "토큰")!.ownerId).toBe("pl2");
  });
});
