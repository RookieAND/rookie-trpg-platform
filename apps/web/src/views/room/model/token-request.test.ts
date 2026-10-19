import { describe, expect, it } from "vitest";
import type { ChatMessage, Member } from "@coc-vtt/shared";
import { TOKEN_REQUEST_TEXT, canRequestToken, isTokenRequest, newTokenRequests, tokenRequestToast } from "./token-request";

const msg = (o: Partial<ChatMessage>): ChatMessage => ({ id: "m" + (o.seq ?? 1), seq: 1, at: 0, session: 0, kind: "whisper", userId: "u1", name: "서하", role: "pl", text: TOKEN_REQUEST_TEXT, ...o });

describe("토큰 요청", () => {
  it("PL의 약속한 귓속말만 요청이에요", () => {
    expect(isTokenRequest(msg({}))).toBe(true);
    expect(isTokenRequest(msg({ kind: "say" }))).toBe(false);
    expect(isTokenRequest(msg({ role: "spectator" }))).toBe(false);
    expect(isTokenRequest(msg({ role: "kp" }))).toBe(false);
    expect(isTokenRequest(msg({ text: "토큰 주세요" }))).toBe(false);
  });
  it("본 번호 뒤에 온 요청만, 사람마다 마지막 하나만 모아요", () => {
    const chat = [msg({ seq: 1 }), msg({ seq: 2, userId: "u2", name: "도윤" }), msg({ seq: 3 }), msg({ seq: 4, kind: "say", text: "안녕" })];
    expect(newTokenRequests(chat, 1)).toEqual([{ userId: "u2", name: "도윤", seq: 2 }, { userId: "u1", name: "서하", seq: 3 }]);
    expect(newTokenRequests(chat, 3)).toEqual([]);
  });
  it("알림 문구는 받침에 맞는 조사를 써요", () => {
    expect(tokenRequestToast("서하")).toBe("서하가 토큰을 요청했어요");
    expect(tokenRequestToast("도윤")).toBe("도윤이 토큰을 요청했어요");
  });
  it("완성한 캐릭터가 있고 토큰이 없는 PL만 요청할 수 있어요", () => {
    const gm = { userId: "g" } as Member;
    expect(canRequestToken({ role: "pl", hasCharacter: true, hasToken: false, gm })).toBe(true);
    expect(canRequestToken({ role: "pl", hasCharacter: false, hasToken: false, gm })).toBe(false);
    expect(canRequestToken({ role: "pl", hasCharacter: true, hasToken: true, gm })).toBe(false);
    expect(canRequestToken({ role: "spectator", hasCharacter: true, hasToken: false, gm })).toBe(false);
    expect(canRequestToken({ role: "pl", hasCharacter: true, hasToken: false, gm: undefined })).toBe(false);
  });
});
