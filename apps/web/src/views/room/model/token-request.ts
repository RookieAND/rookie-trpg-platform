import { josa, type ChatMessage, type Member } from "@coc-vtt/shared";

/**
 * PL이 GM에게 토큰을 부탁하는 귓속말. 새 이벤트를 만들지 않고 기존 귓속말(PL → GM)에 약속된 첫 글을 붙인다.
 * 대화 기록에도 읽히는 문장으로 남고, GM 화면은 이 글을 알아보고 알림에 ‘토큰 놓기’ 버튼을 붙인다.
 */
export const TOKEN_REQUEST_TEXT = "[토큰 요청] 제 토큰을 놓아 주세요.";

/** 토큰 요청 귓속말인가: PL이 보낸 귓속말이고, 글이 약속한 문장이다(관전자·GM이 흉내 내도 무시한다). */
export function isTokenRequest(m: Pick<ChatMessage, "kind" | "role" | "text">): boolean {
  return m.kind === "whisper" && m.role === "pl" && m.text.trim() === TOKEN_REQUEST_TEXT;
}

/** seen 번호 뒤에 새로 온 토큰 요청들(요청자 id와 이름). 같은 사람이 여러 번 보냈으면 마지막 하나만. */
export function newTokenRequests(chat: readonly ChatMessage[], seenSeq: number): Array<{ userId: string; name: string; seq: number }> {
  const last = new Map<string, { userId: string; name: string; seq: number }>();
  for (const m of chat) if (m.seq > seenSeq && isTokenRequest(m)) last.set(m.userId, { userId: m.userId, name: m.name, seq: m.seq });
  return [...last.values()].sort((a, b) => a.seq - b.seq);
}

export function tokenRequestToast(name: string): string {
  return `${josa(name, "이/가")} 토큰을 요청했어요`;
}

/** PL이 요청 버튼을 볼 조건: 완성한 캐릭터가 있고 아직 토큰이 없는 PL. 관전자는 제외. */
export function canRequestToken(o: { role: string; hasCharacter: boolean; hasToken: boolean; gm: Member | undefined }): boolean {
  return o.role === "pl" && o.hasCharacter && !o.hasToken && Boolean(o.gm);
}
