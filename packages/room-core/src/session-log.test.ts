import { describe, expect, it } from "vitest";
import { LOG_KEEP, formatSessionLog, type ClientCommand, type LogEntryView, type LogKind } from "@coc-vtt/shared";
import { Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl1: Actor = { userId: "pl1", name: "서하", role: "pl" };
const pl2: Actor = { userId: "pl2", name: "도윤", role: "pl" };
const spec: Actor = { userId: "sp1", name: "관전", role: "spectator" };

const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const sheet = (name: string, dex = 50) => ({
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

let n = 0;
let clock = 1_760_000_000_000;
const setup = () => {
  clock = 1_760_000_000_000;
  const room = new Room("r", { newId: () => `id-${++n}`, rng: () => 0.5, now: () => (clock += 1000), rollsPerSecond: 50 });
  for (const a of [kp, pl1, pl2, spec]) room.join(a);
  return room;
};
const kinds = (log: { entries: LogEntryView[] }) => log.entries.map((e) => e.kind);
const texts = (room: Room, who: Actor) => room.logFor(who).entries.map((e) => e.text);
const json = (room: Room, who: Actor) => JSON.stringify(room.logFor(who));

describe("세션 기록: 무엇을 남기나", () => {
  it("세션 시작·일시정지·이어하기·종료를 이유와 함께 남긴다", () => {
    const room = setup();
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(kp, cmd("session.pause", {})));
    must(room.handle(kp, cmd("session.resume", {})));
    must(room.handle(kp, cmd("session.end", { ending: "해피엔딩" })));
    expect(texts(room, pl1)).toEqual(["세션 1 시작", "일시정지 (GM이 멈췄어요)", "이어하기 (GM이 이어갔어요)", "세션 1 종료 · 엔딩: 해피엔딩"]);
  });

  it("GM 연결이 끊겨 멈추고 돌아와 이어진 것도 이유가 남는다", () => {
    const room = setup();
    must(room.handle(kp, cmd("session.start", {})));
    room.leave(kp.userId);
    room.expireKpAway();
    room.join(kp);
    expect(texts(room, kp)).toEqual(["세션 1 시작", "일시정지 (GM 연결이 끊겼어요)", "GM이 돌아와서 세션을 이어가요."]);
  });

  it("장면 전환은 장면 이름과 함께 남고 이후 기록에 그 장면이 붙는다", () => {
    const room = setup();
    must(room.handle(kp, cmd("session.start", {})));
    const out = must(room.handle(kp, cmd("scene.create", { name: "지하실" })));
    const id = (out[0]!.event as { data: { id: string } }).data.id;
    must(room.handle(kp, cmd("scene.activate", { id, transition: "fade" })));
    must(room.handle(pl1, cmd("chat.send", { text: "어둡네요" })));
    const entries = room.logFor(pl1).entries;
    expect(entries.map((e) => [e.kind, e.scene])).toEqual([["session", "장면 1"], ["scene", "지하실"], ["chat", "지하실"]]);
    expect(entries[1]!.text).toBe("장면 전환: 지하실 (페이드)");
  });

  it("공개 굴림은 남고 비밀 굴림(GM·대화 /hr)은 GM에게도 남지 않는다", () => {
    const room = setup();
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(pl1, cmd("roll.request", { expr: "1d100", secret: false })));
    must(room.handle(kp, cmd("roll.request", { expr: "1d6+99", secret: true })));
    clock += 2000;
    must(room.handle(pl1, cmd("chat.send", { text: "/hr 3d8+77" })));
    clock += 2000;
    must(room.handle(pl1, cmd("chat.send", { text: "/r 2d4" })));
    const gm = room.logFor(kp);
    expect(gm.entries.filter((e) => e.kind === "roll").map((e) => e.roll!.expr)).toEqual(["1d100", "2d4"]);
    expect(JSON.stringify(gm)).not.toContain("1d6+99");
    expect(JSON.stringify(gm)).not.toContain("3d8+77");
    expect(gm.entries.find((e) => e.kind === "roll")!.roll!.who).toBe("서하");
  });

  it("SAN 체크는 SAN 기록으로 남는다", () => {
    const room = setup();
    must(room.handle(pl1, cmd("character.add", sheet("윤서하"))));
    must(room.handle(kp, cmd("session.start", {})));
    const id = room.snapshot(pl1).characters[0]!.id;
    must(room.handle(pl1, cmd("san.check", { characterId: id, loss: "0/1d3" })));
    const e = room.logFor(pl1).entries.find((x) => x.kind === "sanity")!;
    expect(e.text).toContain("윤서하 · SAN 체크");
    expect(e.text).toContain("SAN 50");
  });

  it("대화는 공개된 말만 남고 귓속말·비밀 굴림은 남지 않는다", () => {
    const room = setup();
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(pl1, cmd("chat.send", { text: "안녕하세요" })));
    clock += 2000;
    must(room.handle(kp, cmd("chat.send", { text: "/w 서하 비밀 단서예요" })));
    clock += 2000;
    must(room.handle(spec, cmd("chat.send", { text: "구경 중" })));
    for (const w of [kp, pl1, pl2, spec]) {
      expect(room.logFor(w).entries.filter((e) => e.kind === "chat").map((e) => e.chat!.text)).toEqual(["안녕하세요", "구경 중"]);
      expect(json(room, w)).not.toContain("비밀 단서");
    }
  });

  it("전투 시작·차례·종료를 남기고 참가자 기록에서는 NPC 이름을 가린다", () => {
    const room = setup();
    must(room.handle(pl1, cmd("character.add", sheet("윤서하", 60))));
    must(room.handle(kp, cmd("character.add", sheet("비밀교단원", 80))));
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(kp, cmd("initiative.start", {})));
    must(room.handle(kp, cmd("initiative.next", {})));
    must(room.handle(kp, cmd("initiative.end", {})));
    expect(texts(room, kp)).toEqual(["세션 1 시작", "전투 시작 · 2명", "라운드 1 · 윤서하 차례", "전투 종료 · 1라운드"]);
    // 첫 차례(turn 0)는 NPC였고 next로 윤서하 차례가 됐다. 처음 칸도 한 번 돌려 NPC 차례를 만든다.
    must(room.handle(kp, cmd("initiative.start", {})));
    must(room.handle(kp, cmd("initiative.next", {})));
    must(room.handle(kp, cmd("initiative.next", {})));
    expect(texts(room, kp).filter((t) => t.includes("비밀교단원"))).toHaveLength(1);
    expect(json(room, pl1)).not.toContain("비밀교단원");
    expect(json(room, spec)).not.toContain("비밀교단원");
    expect(texts(room, pl1)).toContain("라운드 2 · 알 수 없는 상대 차례");
  });

  it("피해·회복은 그 시트의 주인과 GM만 본다(NPC는 GM만)", () => {
    const room = setup();
    must(room.handle(pl1, cmd("character.add", sheet("윤서하"))));
    must(room.handle(pl2, cmd("character.add", sheet("한도윤"))));
    must(room.handle(kp, cmd("character.add", sheet("비밀교단원"))));
    must(room.handle(kp, cmd("session.start", {})));
    const chars = room.snapshot(kp).characters;
    const id = (name: string) => chars.find((c) => c.name === name)!.id;
    must(room.handle(kp, cmd("damage.apply", { characterId: id("윤서하"), amount: 4, armor: 0 })));
    must(room.handle(kp, cmd("damage.apply", { characterId: id("비밀교단원"), amount: 3, armor: 0 })));
    must(room.handle(kp, cmd("hp.heal", { characterId: id("윤서하"), kind: "manual", amount: 2 })));
    expect(room.logFor(kp).entries.filter((e) => e.kind === "damage")).toHaveLength(3);
    expect(room.logFor(pl1).entries.filter((e) => e.kind === "damage").map((e) => e.text)).toEqual(["윤서하 피해 4 (HP 10 → 6) · 부상", "윤서하 회복 +2 (HP 6 → 8)"]);
    for (const w of [pl2, spec]) expect(kinds(room.logFor(w))).not.toContain("damage");
    expect(json(room, pl1)).not.toContain("비밀교단원");
  });

  it("핸드아웃 공개는 제목만 남고, 초안·GM 노트는 남지 않으며, 일부에게 공개한 것은 그 사람만 본다", () => {
    const room = setup();
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(kp, cmd("handout.create", { title: "초안 편지", body: "초안 본문 비밀", visibleTo: "gm" })));
    must(room.handle(kp, cmd("handout.create", { title: "GM 열쇠 메모", body: "범인은 집사", visibleTo: "gm", kpOnly: true })));
    must(room.handle(kp, cmd("handout.create", { title: "모두의 지도", body: "지도 본문", visibleTo: "all" })));
    must(room.handle(kp, cmd("handout.create", { title: "서하만의 쪽지", body: "쪽지 본문", visibleTo: ["pl1"] })));
    const gm = room.logFor(kp).entries.filter((e) => e.kind === "handout");
    expect(gm.map((e) => e.text)).toEqual(["핸드아웃 공개: 「모두의 지도」", "핸드아웃 공개: 「서하만의 쪽지」 → 서하"]);
    expect(room.logFor(pl1).entries.filter((e) => e.kind === "handout").map((e) => e.text)).toEqual(["핸드아웃 공개: 「모두의 지도」", "핸드아웃 공개: 「서하만의 쪽지」"]);
    expect(room.logFor(pl2).entries.filter((e) => e.kind === "handout").map((e) => e.text)).toEqual(["핸드아웃 공개: 「모두의 지도」"]);
    for (const w of [kp, pl1, pl2, spec]) {
      const j = json(room, w);
      expect(j).not.toContain("초안");
      expect(j).not.toContain("GM 열쇠");
      expect(j).not.toContain("범인");
      expect(j).not.toContain("지도 본문");
      expect(j).not.toContain("쪽지 본문");
    }
    // 초안을 공개하며 펼치면 그때 남는다
    const draft = room.snapshot(kp).handouts.find((h) => h.title === "초안 편지")!;
    must(room.handle(kp, cmd("handout.show", { id: draft.id, reveal: true })));
    expect(texts(room, pl2)).toContain("핸드아웃 공개: 「초안 편지」");
  });

  it("비트 이동은 GM 기록에만 남는다", () => {
    const room = setup();
    must(room.handle(kp, cmd("flow.beat.upsert", { name: "도서관의 비밀", kind: "start", memo: "범인은 집사", handoutIds: [] })));
    must(room.handle(kp, cmd("session.start", {})));
    const gm = room.logFor(kp).entries.find((e) => e.kind === "beat")!;
    expect(gm).toMatchObject({ text: "비트 이동: 도서관의 비밀 (시작)", scope: "gm" });
    for (const w of [pl1, pl2, spec]) {
      expect(kinds(room.logFor(w))).not.toContain("beat");
      expect(json(room, w)).not.toContain("도서관의 비밀");
      expect(json(room, w)).not.toContain("범인");
    }
  });

  it("GM 기록에는 공개 범위가 좁은 기록에 표시가 붙는다", () => {
    const room = setup();
    must(room.handle(kp, cmd("handout.create", { title: "일부 공개", body: "", visibleTo: ["pl1"] })));
    expect(room.logFor(kp).entries[0]!.scope).toBe("some");
    expect(room.logFor(pl1).entries[0]!.scope).toBeUndefined();
  });
});

describe("세션 기록: 조회와 필터", () => {
  const busy = () => {
    const room = setup();
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(pl1, cmd("roll.request", { expr: "1d100", secret: false })));
    clock += 5000;
    must(room.handle(pl1, cmd("chat.send", { text: "첫 말" })));
    clock += 5000;
    must(room.handle(kp, cmd("session.end", {})));
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(pl2, cmd("roll.request", { expr: "1d6", secret: false })));
    return room;
  };

  it("종류·세션·시간으로 거른다", () => {
    const room = busy();
    expect(kinds(room.logFor(pl1, { kinds: ["roll"] }))).toEqual(["roll", "roll"]);
    expect(room.logFor(pl1, { session: 2 }).entries.map((e) => e.kind)).toEqual(["session", "roll"]);
    const all = room.logFor(pl1).entries;
    const mid = all.find((e) => e.kind === "chat")!;
    expect(room.logFor(pl1, { since: mid.at }).entries[0]!.kind).toBe("chat");
    expect(room.logFor(pl1, { until: mid.at - 1 }).entries.every((e) => e.at < mid.at)).toBe(true);
    expect(room.logFor(pl1, { kinds: ["chat"] as LogKind[], session: 2 }).entries).toHaveLength(0);
  });

  it("최근 것부터 limit개를 주고 before로 이전 기록을 이어 받는다", () => {
    const room = busy();
    const total = room.logFor(pl1).total;
    const p1 = room.logFor(pl1, { limit: 3 });
    expect(p1.entries).toHaveLength(3);
    expect(p1.hasMore).toBe(true);
    expect(p1.total).toBe(total);
    const p2 = room.logFor(pl1, { limit: 100, before: p1.entries[0]!.n });
    expect(p2.entries.length + p1.entries.length).toBe(total);
    expect(p2.hasMore).toBe(false);
    expect(p2.entries.at(-1)!.n).toBeLessThan(p1.entries[0]!.n);
  });

  it("최근 2000개만 기억한다", () => {
    const room = setup();
    must(room.handle(kp, cmd("session.start", {})));
    for (let i = 0; i < LOG_KEEP + 30; i++) {
      clock += 400;
      must(room.handle(pl1, cmd("chat.send", { text: `말 ${i}` })));
    }
    expect(room.toData().log).toHaveLength(LOG_KEEP);
    expect(room.logFor(kp, { limit: 500 }).total).toBe(LOG_KEEP);
  });
});

describe("세션 기록: 저장하고 다시 열기", () => {
  it("대화·설정·기록이 저장 데이터에 담겨 돌아오고, 번호는 이어진다", () => {
    const room = setup();
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(kp, cmd("settings.chat", { plWhisper: true })));
    must(room.handle(pl1, cmd("chat.send", { text: "안녕" })));
    clock += 2000;
    must(room.handle(kp, cmd("chat.send", { text: "귓말", to: "pl1" })));
    const data = JSON.parse(JSON.stringify(room.toData()));
    expect(data.schemaVersion).toBe(2);
    const back = Room.fromData(data, { now: () => (clock += 1000), newId: () => `x-${++n}` });
    expect(back.chatHistory(pl1).map((m) => m.text)).toEqual(["안녕", "귓말"]);
    expect(back.chatHistory(pl2).map((m) => m.text)).toEqual(["안녕"]);
    expect(back.snapshot(kp).chatSettings).toEqual({ plWhisper: true });
    expect(back.logFor(kp).entries.length).toBeGreaterThan(0);
    back.join(kp); // 서버가 다시 켜진 뒤 GM이 돌아오면 자동으로 이어진다
    const ns = back.logFor(kp).entries.map((e) => e.n);
    expect(new Set(ns).size).toBe(ns.length);
    expect(ns).toEqual([...ns].sort((a, b) => a - b));
  });
});

describe("기록 내보내기(마크다운) — 참가자용에는 숨은 내용이 없다", () => {
  const play = () => {
    const room = setup();
    must(room.handle(pl1, cmd("character.add", sheet("윤서하", 60))));
    must(room.handle(kp, cmd("character.add", sheet("비밀교단원", 80))));
    must(room.handle(kp, cmd("flow.beat.upsert", { name: "비밀 시작", kind: "start", memo: "", handoutIds: [] })));
    must(room.handle(kp, cmd("handout.create", { title: "GM 노트 제목", body: "GM 노트 본문", visibleTo: "gm", kpOnly: true })));
    must(room.handle(kp, cmd("handout.create", { title: "초안 단서", body: "초안 본문", visibleTo: "gm" })));
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(kp, cmd("handout.create", { title: "찢어진 편지", body: "편지 본문", visibleTo: "all" })));
    must(room.handle(pl1, cmd("roll.request", { expr: "1d100", secret: false })));
    must(room.handle(kp, cmd("roll.request", { expr: "1d20+77", secret: true })));
    clock += 3000;
    must(room.handle(pl1, cmd("chat.send", { text: "/hr 4d4+55" })));
    clock += 3000;
    must(room.handle(pl1, cmd("chat.send", { text: "문을 열어 볼게요" })));
    clock += 3000;
    must(room.handle(kp, cmd("chat.send", { text: "/w 서하 뒤에서 소리가 나요" })));
    must(room.handle(kp, cmd("initiative.start", {})));
    must(room.handle(kp, cmd("initiative.next", {})));
    must(room.handle(kp, cmd("initiative.next", {})));
    return room;
  };
  const opts = { title: "테스트 룸", exportedAt: 1_760_000_100_000, timeZone: "Asia/Seoul" } as const;

  it("GM용은 GM 전용 기록을 담고, 참가자용은 담지 않는다", () => {
    const room = play();
    const gm = formatSessionLog(room.logFor(kp, { limit: 500 }).entries, { ...opts, audience: "gm" });
    expect(gm).toContain("# 테스트 룸");
    expect(gm).toContain("GM용 기록");
    expect(gm).toContain("비트 이동: 비밀 시작 (시작) (GM 전용)");
    expect(gm).toContain("비밀교단원");
    // 모든 사람에게 같은 기록을 주는 공개판(GM이 참가자에게 공유할 때): 사용자 없는 pl 시점
    const pub = formatSessionLog(room.logFor({ userId: "", role: "pl" }, { limit: 500 }).entries, { ...opts, audience: "public" });
    expect(pub).toContain("참가자에게 보이는 내용만");
    for (const secret of ["비밀 시작", "비밀교단원", "GM 노트", "초안", "1d20+77", "4d4+55", "뒤에서 소리", "(GM 전용)"]) expect(pub).not.toContain(secret);
    for (const who of [pl1, pl2, spec]) {
      const md = formatSessionLog(room.logFor(who, { limit: 500 }).entries, { ...opts, audience: "public" });
      for (const secret of ["비밀 시작", "비밀교단원", "GM 노트", "초안", "1d20+77", "4d4+55", "(GM 전용)"]) expect(md).not.toContain(secret);
    }
    // 서하는 자기가 받은 귓속말을 기록으로는 갖지 않는다(귓속말은 기록에 없다)
    expect(formatSessionLog(room.logFor(pl1, { limit: 500 }).entries, { ...opts, audience: "public" })).not.toContain("뒤에서 소리");
  });

  it("공개 기록 마크다운에는 날짜·장면 구획, 굴림 표, 핸드아웃 제목, 대화 발췌가 있다", () => {
    const room = play();
    const md = formatSessionLog(room.logFor(pl2, { limit: 500 }).entries, { ...opts, audience: "public" });
    expect(md).toMatch(/## 세션 1 · \d{4}-\d{2}-\d{2}/);
    expect(md).toContain("### 장면 1");
    expect(md).toContain("- ");
    expect(md).toContain("핸드아웃 공개: 「찢어진 편지」");
    expect(md).toContain("**굴림**");
    expect(md).toContain("| 시각 | 누가 | 식 | 결과 |");
    expect(md).toMatch(/\| \d{2}:\d{2} \| 서하 \| `1d100` \| /);
    expect(md).toContain("**대화 발췌**");
    expect(md).toMatch(/> \d{2}:\d{2} \*\*서하\*\* 문을 열어 볼게요/);
    expect(md).not.toContain("편지 본문");
  });
});
