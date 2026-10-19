import { describe, expect, it } from "vitest";
import { CHAT_KEEP, CHAT_MAX_LENGTH, type ChatMessage, type ClientCommand } from "@coc-vtt/shared";
import { Room, inAudience, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl1: Actor = { userId: "pl1", name: "서하", role: "pl" };
const pl2: Actor = { userId: "pl2", name: "도윤", role: "pl" };
const spec: Actor = { userId: "sp1", name: "관전", role: "spectator" };

const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const chatOf = (out: Out[], who: Actor) => out.filter((o) => inAudience(o.audience, who) && o.event.type === "chat.posted").map((o) => (o.event as { data: ChatMessage }).data);
const received = (out: Out[], who: Actor) => JSON.stringify(out.filter((o) => inAudience(o.audience, who)).map((o) => o.event));

const sheet = (name: string) => ({
  name,
  age: 30,
  occupation: "",
  characteristics: { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 },
  luck: 50,
  skills: [],
  notes: "",
  backstory: "",
  possessions: "",
  weapons: [],
});

let n = 0;
/** 테스트가 직접 돌리는 시계. say()는 보낼 때마다 0.4초씩 보내서 속도 제한에 걸리지 않는다. */
let clock = 1_000_000;
const setup = (opts: { now?: () => number; active?: boolean } = {}) => {
  clock = 1_000_000;
  const room = new Room("r", { newId: () => `id-${++n}`, rng: () => 0.5, now: opts.now ?? (() => clock), rollsPerSecond: 50 });
  for (const a of [kp, pl1, pl2, spec]) room.join(a);
  if (opts.active !== false) must(room.handle(kp, cmd("session.start", {})));
  return room;
};
const sayFast = (room: Room, who: Actor, text: string, extra: Partial<Extract<ClientCommand, { type: "chat.send" }>["data"]> = {}) => room.handle(who, cmd("chat.send", { text, ...extra }));
const say = (room: Room, who: Actor, text: string, extra: Partial<Extract<ClientCommand, { type: "chat.send" }>["data"]> = {}) => {
  clock += 400;
  return sayFast(room, who, text, extra);
};

describe("대화 보내기", () => {
  it("모두가 받고, 글은 다듬어서 저장한다", () => {
    const room = setup();
    const out = must(say(room, pl1, "  안녕하세요\r\n\r\n\r\n\r\n반가워요  "));
    for (const w of [kp, pl1, pl2, spec]) {
      const [m] = chatOf(out, w);
      expect(m).toMatchObject({ kind: "say", name: "서하", userId: "pl1", role: "pl", text: "안녕하세요\n\n반가워요" });
    }
    expect(room.chatHistory(pl2)).toHaveLength(1);
  });

  it("HTML은 글자 그대로 둔다(태그를 지우지도 해석하지도 않는다)", () => {
    const room = setup();
    must(say(room, pl1, "<img src=x onerror=alert(1)> <b>굵게</b>"));
    expect(room.chatHistory(kp)[0]!.text).toBe("<img src=x onerror=alert(1)> <b>굵게</b>");
  });

  it("빈 글·500자 초과는 거절한다", () => {
    const room = setup();
    expect(say(room, pl1, "   \n ").ok).toBe(false);
    const long = say(room, pl1, "가".repeat(CHAT_MAX_LENGTH + 1));
    expect(long.ok).toBe(false);
    expect(say(room, pl1, "가".repeat(CHAT_MAX_LENGTH)).ok).toBe(true);
  });

  it("세션 전과 일시정지 중에도 말할 수 있지만 주사위는 진행 중에만 굴린다", () => {
    const room = setup({ active: false });
    expect(say(room, pl1, "일찍 왔어요").ok).toBe(true);
    const r = say(room, pl1, "/r 1d100");
    expect(r).toMatchObject({ ok: false, code: "idle" });
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(kp, cmd("session.pause", {})));
    expect(say(room, pl1, "잠깐 쉬어요").ok).toBe(true);
    expect(say(room, pl1, "/r 1d100")).toMatchObject({ ok: false, code: "paused" });
    expect(say(room, kp, "/r 1d100")).toMatchObject({ ok: false, code: "paused" });
  });

  it("관전자는 기본으로 읽기만 하고, GM이 '관전자 대화'를 켜면 공개로 말할 수 있지만 굴리거나 귓속말은 못 한다", () => {
    const room = setup();
    expect(say(room, spec, "구경 중이에요")).toMatchObject({ ok: false, code: "forbidden" });
    expect(room.chatHistory(pl1)).toHaveLength(0);
    expect(room.handle(pl1, cmd("settings.chat", { plWhisper: false, spectatorChat: true }))).toMatchObject({ ok: false, code: "forbidden" });
    must(room.handle(kp, cmd("settings.chat", { plWhisper: false, spectatorChat: true })));
    expect(say(room, spec, "구경 중이에요").ok).toBe(true);
    must(room.handle(kp, cmd("settings.chat", { plWhisper: false, spectatorChat: false })));
    expect(say(room, spec, "또 말해요")).toMatchObject({ ok: false, code: "forbidden" });
    must(room.handle(kp, cmd("settings.chat", { plWhisper: false, spectatorChat: true })));
    expect(say(room, spec, "/r 1d6")).toMatchObject({ ok: false, code: "forbidden" });
    expect(say(room, spec, "비밀이에요", { to: "kp1" })).toMatchObject({ ok: false, code: "forbidden" });
    expect(say(room, spec, "나도 캐릭터", { speaker: { gm: true } })).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("사용자마다 초당 3번까지 보낼 수 있다", () => {
    const room = setup();
    for (let i = 0; i < 3; i++) expect(sayFast(room, pl1, `하나 ${i}`).ok).toBe(true);
    expect(sayFast(room, pl1, "넷")).toMatchObject({ ok: false, code: "rate_limited" });
    // 다른 사람의 한도는 따로 센다
    expect(sayFast(room, pl2, "저는 괜찮아요").ok).toBe(true);
  });

  it("시간이 지나면 다시 보낼 수 있다", () => {
    const room = setup();
    for (let i = 0; i < 3; i++) must(sayFast(room, pl1, `하나 ${i}`));
    expect(sayFast(room, pl1, "넷").ok).toBe(false);
    clock += 1100;
    expect(sayFast(room, pl1, "넷").ok).toBe(true);
  });

  it("최근 500개만 기억한다", () => {
    const room = setup();
    for (let i = 0; i < CHAT_KEEP + 20; i++) must(say(room, pl1, `말 ${i}`));
    const all = room.chatHistory(kp, 1000);
    expect(all).toHaveLength(CHAT_KEEP);
    expect(all[0]!.text).toBe("말 20");
    expect(room.toData().chat).toHaveLength(CHAT_KEEP);
  });
});

describe("캐릭터로 말하기", () => {
  const withSheets = () => {
    const room = setup();
    must(room.handle(pl1, cmd("character.add", sheet("윤서하"))));
    must(room.handle(pl2, cmd("character.add", sheet("한도윤"))));
    must(room.handle(kp, cmd("character.add", sheet("비밀교단원"))));
    const idOf = (name: string) => room.snapshot(kp).characters.find((c) => c.name === name)!.id;
    return { room, idOf };
  };

  it("PL은 자기 캐릭터 이름으로 말하고, 남의 캐릭터로는 말할 수 없다", () => {
    const { room, idOf } = withSheets();
    const out = must(say(room, pl1, "안녕하세요", { speaker: { characterId: idOf("윤서하") } }));
    expect(chatOf(out, pl2)[0]).toMatchObject({ name: "윤서하", userId: "pl1" });
    expect(say(room, pl1, "가로채기", { speaker: { characterId: idOf("한도윤") } })).toMatchObject({ ok: false, code: "forbidden" });
    expect(say(room, pl1, "NPC", { speaker: { characterId: idOf("비밀교단원") } })).toMatchObject({ ok: false, code: "forbidden" });
    expect(say(room, pl1, "GM", { speaker: { gm: true } })).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("GM은 NPC 시트나 \"GM\"으로 말할 수 있다", () => {
    const { room, idOf } = withSheets();
    expect(chatOf(must(say(room, kp, "…따라와", { speaker: { characterId: idOf("비밀교단원") } })), pl1)[0]!.name).toBe("비밀교단원");
    expect(chatOf(must(say(room, kp, "공지예요", { speaker: { gm: true } })), pl1)[0]!.name).toBe("GM");
    expect(chatOf(must(say(room, kp, "그냥 말해요")), pl1)[0]!.name).toBe("하늘");
  });

  it("보낸 메시지에 시트 id는 담기지 않는다", () => {
    const { room, idOf } = withSheets();
    const out = must(say(room, kp, "…", { speaker: { characterId: idOf("비밀교단원") } }));
    expect(received(out, pl1)).not.toContain(idOf("비밀교단원"));
  });
});

describe("/r 굴림", () => {
  it("공개 굴림은 대화와 굴림 기록에 함께 남고 모두가 받는다", () => {
    const room = setup();
    const out = must(say(room, pl1, "/r 1d100"));
    const types = out.map((o) => o.event.type);
    expect(types).toContain("roll.result");
    for (const w of [kp, pl2, spec]) {
      const [m] = chatOf(out, w);
      expect(m).toMatchObject({ kind: "roll", name: "서하", roll: { expr: "1d100", result: expect.stringContaining("51") } });
      expect(m!.roll!.rollId).toBe(room.snapshot(kp).rolls.at(-1)!.id);
    }
    expect(room.snapshot(pl2).rolls).toHaveLength(1);
  });

  it("/roll도 같고, 식이 없거나 틀리면 거절한다", () => {
    const room = setup();
    expect(say(room, pl1, "/roll 2d6+1").ok).toBe(true);
    expect(say(room, pl1, "/r")).toMatchObject({ ok: false, code: "bad_message" });
    expect(say(room, pl1, "/r 아무말")).toMatchObject({ ok: false, code: "bad_roll" });
    expect(say(room, pl1, "/zzz")).toMatchObject({ ok: false, code: "bad_message" });
  });

  it("//로 시작하면 슬래시 하나를 빼고 그대로 말한다", () => {
    const room = setup();
    const out = must(say(room, pl1, "//r 은 굴림 명령이에요"));
    expect(chatOf(out, kp)[0]).toMatchObject({ kind: "say", text: "/r 은 굴림 명령이에요" });
  });

  it("/hr 비밀 굴림: GM과 굴린 사람만 결과를 받고, 다른 PL·관전자에게는 알림만 간다", () => {
    const room = setup();
    const out = must(say(room, pl1, "/hr 1d100"));
    expect(chatOf(out, kp)[0]).toMatchObject({ kind: "secret", name: "서하" });
    expect(chatOf(out, pl1)[0]).toMatchObject({ kind: "secret" });
    for (const w of [pl2, spec]) {
      expect(chatOf(out, w)).toHaveLength(0);
      const json = received(out, w);
      expect(json).not.toContain("1d100");
      expect(json).not.toContain("51");
      expect(json).not.toContain('"outcome"');
    }
    expect(room.snapshot(pl2).rolls).toHaveLength(0);
    expect(room.chatHistory(pl2)).toHaveLength(0);
    expect(room.chatHistory(spec)).toHaveLength(0);
    expect(room.chatHistory(pl1)).toHaveLength(1);
    expect(room.chatHistory(kp)).toHaveLength(1);
  });

  it("GM의 /hr은 GM만 본다", () => {
    const room = setup();
    const out = must(say(room, kp, "/hr 1d20"));
    expect(chatOf(out, kp)).toHaveLength(1);
    for (const w of [pl1, pl2, spec]) {
      expect(chatOf(out, w)).toHaveLength(0);
      expect(received(out, w)).not.toContain("1d20");
    }
  });

  it("db는 말하는 캐릭터의 피해 보너스를 쓴다", () => {
    const room = setup();
    must(room.handle(pl1, cmd("character.add", sheet("윤서하"))));
    const id = room.snapshot(pl1).characters[0]!.id;
    expect(say(room, pl1, "/r 1d3+db", { speaker: { characterId: id } }).ok).toBe(true);
  });
});

describe("귓속말", () => {
  const out = (room: Room, who: Actor, text: string, extra: Partial<Extract<ClientCommand, { type: "chat.send" }>["data"]> = {}) => must(say(room, who, text, extra));

  it("GM → PL: 받는 PL과 GM만 받고, 다른 PL·관전자는 프레임에도 기록에도 없다", () => {
    const room = setup();
    const o = out(room, kp, "/w 서하 문 뒤에 누가 있어요");
    expect(chatOf(o, pl1)[0]).toMatchObject({ kind: "whisper", text: "문 뒤에 누가 있어요", to: { userId: "pl1", name: "서하" } });
    expect(chatOf(o, kp)).toHaveLength(1);
    for (const w of [pl2, spec]) {
      expect(received(o, w)).not.toContain("문 뒤");
      expect(room.chatHistory(w)).toHaveLength(0);
      expect(room.chatPage(w, 9999).messages).toHaveLength(0);
    }
    expect(room.chatHistory(pl1)).toHaveLength(1);
    expect(JSON.stringify(room.snapshot(pl2))).not.toContain("문 뒤");
    expect(JSON.stringify(room.snapshot(spec))).not.toContain("문 뒤");
    // 놓친 구간을 다시 받을 때도(재접속) 새지 않는다
    expect(JSON.stringify(room.eventsSince(pl2, 0))).not.toContain("문 뒤");
    expect(JSON.stringify(room.eventsSince(spec, 0))).not.toContain("문 뒤");
    expect(JSON.stringify(room.eventsSince(pl1, 0))).toContain("문 뒤");
  });

  it("PL → GM: GM이 받는다. 받는 사람 지정(to)으로도 보낼 수 있다", () => {
    const room = setup();
    const o = out(room, pl1, "/w GM 몰래 말씀드려요");
    expect(chatOf(o, kp)[0]).toMatchObject({ kind: "whisper", name: "서하" });
    const o2 = out(room, pl1, "/w 가 아니라 그냥 글이에요", { to: "kp1" });
    expect(chatOf(o2, kp)[0]!.text).toBe("/w 가 아니라 그냥 글이에요");
    expect(received(o, pl2)).not.toContain("몰래");
    expect(received(o2, pl2)).not.toContain("그냥 글");
  });

  it("PL ↔ PL 귓속말은 기본으로 꺼져 있다", () => {
    const room = setup();
    expect(say(room, pl1, "/w 도윤 비밀이야")).toMatchObject({ ok: false, code: "forbidden" });
    expect(say(room, pl1, "비밀이야", { to: "pl2" })).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("GM이 켜면 PL끼리 보낼 수 있고, 그 귓속말은 GM도 받지 못한다", () => {
    const room = setup();
    must(room.handle(kp, cmd("settings.chat", { plWhisper: true })));
    expect(room.snapshot(pl1).chatSettings).toMatchObject({ plWhisper: true });
    const o = out(room, pl1, "/w 도윤 GM 몰래 하자");
    expect(chatOf(o, pl2)).toHaveLength(1);
    expect(chatOf(o, pl1)).toHaveLength(1);
    for (const w of [kp, spec]) {
      expect(chatOf(o, w)).toHaveLength(0);
      expect(received(o, w)).not.toContain("GM 몰래");
      expect(room.chatHistory(w)).toHaveLength(0);
      expect(JSON.stringify(room.eventsSince(w, 0))).not.toContain("GM 몰래");
    }
    expect(room.chatHistory(pl2)).toHaveLength(1);
    // 다시 끄면 막힌다
    must(room.handle(kp, cmd("settings.chat", { plWhisper: false })));
    expect(say(room, pl1, "또 하자", { to: "pl2" }).ok).toBe(false);
  });

  it("설정은 GM만 바꾼다", () => {
    const room = setup();
    expect(room.handle(pl1, cmd("settings.chat", { plWhisper: true }))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("받는 사람이 없거나 관전자이거나 나 자신이면 거절한다", () => {
    const room = setup();
    expect(say(room, kp, "/w 없는사람 안녕")).toMatchObject({ ok: false, code: "bad_message" });
    expect(say(room, kp, "안녕", { to: "sp1" })).toMatchObject({ ok: false, code: "not_found" });
    expect(say(room, kp, "안녕", { to: "kp1" })).toMatchObject({ ok: false, code: "bad_message" });
    expect(say(room, kp, "안녕", { to: "nobody" })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("GM은 PL의 캐릭터 이름으로 귓속말을 보낼 수 있지만, PL은 그 이름으로 다른 PL을 찾을 수 없다", () => {
    const room = setup();
    must(room.handle(kp, cmd("settings.chat", { plWhisper: true })));
    must(room.handle(pl1, cmd("character.add", sheet("윤서하"))));
    must(room.handle(pl2, cmd("character.add", sheet("한도윤"))));
    expect(chatOf(out(room, kp, "/w 한도윤 이쪽으로"), pl2)).toHaveLength(1);
    expect(say(room, pl1, "/w 한도윤 이쪽으로")).toMatchObject({ ok: false, code: "bad_message" });
    expect(chatOf(out(room, pl1, "/w 도윤 이쪽으로"), pl2)).toHaveLength(1);
  });

  it("귓속말에도 사용자당 속도 제한이 걸린다", () => {
    const room = setup();
    for (let i = 0; i < 3; i++) must(sayFast(room, kp, `속삭임 ${i}`, { to: "pl1" }));
    expect(sayFast(room, kp, "넷", { to: "pl1" })).toMatchObject({ ok: false, code: "rate_limited" });
  });
});

describe("대화 기록 전달", () => {
  it("이전 대화 더 보기는 seq 앞쪽을 나눠 주고 볼 수 있는 것만 준다", () => {
    const room = setup();
    for (let i = 0; i < 5; i++) must(say(room, pl1, `말 ${i}`));
    must(say(room, kp, "속삭임", { to: "pl1" }));
    for (let i = 5; i < 8; i++) must(say(room, pl1, `말 ${i}`));
    const all = room.chatHistory(pl2, 100);
    expect(all.map((m) => m.text)).toEqual(["말 0", "말 1", "말 2", "말 3", "말 4", "말 5", "말 6", "말 7"]);
    const page = room.chatPage(pl2, all[5]!.seq, 3);
    expect(page.messages.map((m) => m.text)).toEqual(["말 2", "말 3", "말 4"]);
    expect(page.hasMore).toBe(true);
    expect(room.chatPage(pl1, all[5]!.seq, 100).messages.map((m) => m.text)).toContain("속삭임");
  });

  it("접속 때 최근 100개만 준다", () => {
    const room = setup();
    for (let i = 0; i < 130; i++) must(say(room, pl1, `말 ${i}`));
    const h = room.chatHistory(pl2);
    expect(h).toHaveLength(100);
    expect(h[0]!.text).toBe("말 30");
  });

  it("snapshot에는 대화를 싣지 않는다(프레임 크기)", () => {
    const room = setup();
    must(say(room, pl1, "가".repeat(400)));
    expect(JSON.stringify(room.snapshot(pl2))).not.toContain("가가가가");
  });
});
