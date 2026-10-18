import { describe, expect, it } from "vitest";
import { CHAT_CHUNK_BYTES, type ChatMessage } from "./protocol";
import { canSeeChat, chunkChatHistory, mergeChat, normalizeChatText, parseChatInput, type ChatTarget } from "./chat";

const targets: ChatTarget[] = [
  { userId: "kp1", names: ["하늘", "GM"] },
  { userId: "pl1", names: ["서하", "윤 서하"] },
  { userId: "pl2", names: ["도윤"] },
  { userId: "pl3", names: ["도윤이"] },
];

describe("normalizeChatText", () => {
  it("줄바꿈을 맞추고 제어 문자·글 방향 문자를 지우고 빈 줄을 줄인다", () => {
    expect(normalizeChatText("  가\r\n나\u0000\u202E다\n\n\n\n라  ")).toBe("가\n나다\n\n라");
  });
  it("태그는 건드리지 않는다", () => {
    expect(normalizeChatText("<b>굵게</b>")).toBe("<b>굵게</b>");
  });
});

describe("parseChatInput", () => {
  it("보통 글은 말이다", () => {
    expect(parseChatInput("  안녕하세요 ")).toEqual({ type: "say", text: "안녕하세요" });
    expect(parseChatInput("1/2 정도예요")).toEqual({ type: "say", text: "1/2 정도예요" });
  });
  it("/r, /roll은 공개 굴림, /hr은 비밀 굴림", () => {
    expect(parseChatInput("/r 1d100")).toEqual({ type: "roll", expr: "1d100", secret: false });
    expect(parseChatInput("/ROLL  CC<=50 ")).toEqual({ type: "roll", expr: "CC<=50", secret: false });
    expect(parseChatInput("/hr 2d6+1")).toEqual({ type: "roll", expr: "2d6+1", secret: true });
  });
  it("식이 없으면 오류, 붙여 쓴 명령은 모르는 명령", () => {
    expect(parseChatInput("/r")).toMatchObject({ type: "error" });
    expect(parseChatInput("/r   ")).toMatchObject({ type: "error" });
    expect(parseChatInput("/r1d100")).toMatchObject({ type: "error", message: expect.stringContaining("알 수 없는 명령") });
    expect(parseChatInput("/foo bar")).toMatchObject({ type: "error" });
  });
  it("//는 슬래시를 하나 빼고 말한다", () => {
    expect(parseChatInput("//r 은 굴림이에요")).toEqual({ type: "say", text: "/r 은 굴림이에요" });
  });
  it("/?와 /help는 도움말", () => {
    expect(parseChatInput("/?")).toEqual({ type: "help" });
    expect(parseChatInput("/help")).toEqual({ type: "help" });
  });
  it("/w는 이름으로 받는 사람을 찾는다(GM 별칭, 띄어쓰기 있는 이름, 가장 긴 이름 우선)", () => {
    expect(parseChatInput("/w 서하 안녕", targets)).toEqual({ type: "whisper", to: "pl1", text: "안녕" });
    expect(parseChatInput("/w GM 몰래 말해요", targets)).toEqual({ type: "whisper", to: "kp1", text: "몰래 말해요" });
    expect(parseChatInput("/w 윤 서하 안녕", targets)).toEqual({ type: "whisper", to: "pl1", text: "안녕" });
    expect(parseChatInput("/w 도윤이 안녕", targets)).toEqual({ type: "whisper", to: "pl3", text: "안녕" });
    expect(parseChatInput("/w 도윤 안녕", targets)).toEqual({ type: "whisper", to: "pl2", text: "안녕" });
    expect(parseChatInput("/w gm hi", targets)).toMatchObject({ type: "whisper", to: "kp1" });
  });
  it("이름만 있거나 못 찾거나 이름이 겹치면 오류", () => {
    expect(parseChatInput("/w 서하", targets)).toMatchObject({ type: "error", message: "보낼 내용을 적어 주세요." });
    expect(parseChatInput("/w 모르는사람 안녕", targets)).toMatchObject({ type: "error", message: expect.stringContaining("'모르는사람'을 찾지 못했어요") });
    expect(parseChatInput("/w", targets)).toMatchObject({ type: "error" });
    const twins: ChatTarget[] = [{ userId: "a", names: ["민수"] }, { userId: "b", names: ["민수"] }];
    expect(parseChatInput("/w 민수 안녕", twins)).toMatchObject({ type: "error", message: expect.stringContaining("둘 이상") });
    // 이름 뒤가 공백이 아니면 다른 이름이다
    expect(parseChatInput("/w 서하님 안녕", targets)).toMatchObject({ type: "error" });
  });
});

describe("canSeeChat", () => {
  const w = { kind: "whisper", userId: "pl1", to: { userId: "pl2", name: "도윤" } } as const;
  it("귓속말은 보낸 사람과 받는 사람만 본다(GM도 마찬가지)", () => {
    expect(canSeeChat(w, { userId: "pl1", role: "pl" })).toBe(true);
    expect(canSeeChat(w, { userId: "pl2", role: "pl" })).toBe(true);
    expect(canSeeChat(w, { userId: "kp1", role: "kp" })).toBe(false);
    expect(canSeeChat(w, { userId: "sp", role: "spectator" })).toBe(false);
    expect(canSeeChat({ ...w, userId: "kp1", to: { userId: "pl1", name: "서하" } }, { userId: "kp1", role: "kp" })).toBe(true);
  });
  it("비밀 굴림은 GM과 굴린 사람, 말은 모두", () => {
    const s = { kind: "secret", userId: "pl1" } as const;
    expect(canSeeChat(s, { userId: "kp1", role: "kp" })).toBe(true);
    expect(canSeeChat(s, { userId: "pl1", role: "pl" })).toBe(true);
    expect(canSeeChat(s, { userId: "pl2", role: "pl" })).toBe(false);
    expect(canSeeChat({ kind: "say", userId: "x" }, { userId: "sp", role: "spectator" })).toBe(true);
  });
});

const msg = (i: number, text = `말 ${i}`): ChatMessage => ({ id: `m${i}`, seq: i, at: i, session: 1, kind: "say", userId: "u", name: "이름", role: "pl", text });

describe("chunkChatHistory", () => {
  it("각 조각이 한도를 넘지 않고 순서와 개수가 그대로다", () => {
    const all = Array.from({ length: 100 }, (_, i) => msg(i + 1, "가".repeat(500)));
    const chunks = chunkChatHistory(all);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(new TextEncoder().encode(JSON.stringify({ type: "chat.history", data: { messages: c, last: false } })).length).toBeLessThan(16 * 1024);
    expect(chunks.flat().map((m) => m.id)).toEqual(all.map((m) => m.id));
    expect(CHAT_CHUNK_BYTES).toBeLessThan(16 * 1024);
  });
  it("작으면 한 조각, 없으면 조각 없음", () => {
    expect(chunkChatHistory([msg(1), msg(2)])).toHaveLength(1);
    expect(chunkChatHistory([])).toEqual([]);
  });
});

describe("mergeChat", () => {
  it("id가 같으면 건너뛰고 seq 순으로 놓고 최근 keep개만 남긴다", () => {
    const a = [msg(3), msg(4)];
    expect(mergeChat(a, [msg(1), msg(3), msg(2)], 10).map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(mergeChat(a, [msg(5), msg(6)], 3).map((m) => m.id)).toEqual(["m4", "m5", "m6"]);
    expect(mergeChat(a, [msg(3)], 10)).toBe(a);
  });
});
