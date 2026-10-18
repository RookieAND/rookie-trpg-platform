import { josa } from "./josa";
import { CHAT_CHUNK_BYTES, CHAT_MAX_LENGTH, type ChatMessage } from "./protocol";

/**
 * 대화 글을 다듬는다: 줄바꿈을 \n으로 맞추고, 눈에 안 보이는 제어 문자와 글 방향을 뒤집는 문자를 지우고,
 * 빈 줄을 하나로 줄이고, 앞뒤 공백을 자른다. HTML은 따로 걸러내지 않는다(화면이 글로만 그리므로 태그는 그냥 글자다).
 */
export function normalizeChatText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 귓속말로 부를 수 있는 사람과 부르는 이름들(사용자 이름, GM이면 "GM", PL이면 캐릭터 이름) */
export interface ChatTarget {
  userId: string;
  names: string[];
}

export type ChatInput =
  | { type: "say"; text: string }
  | { type: "roll"; expr: string; secret: boolean }
  | { type: "whisper"; to: string; text: string }
  | { type: "help" }
  | { type: "error"; message: string };

const ROLL = new Set(["/r", "/roll"]);
const HIDDEN_ROLL = new Set(["/hr", "/hroll"]);
const WHISPER = new Set(["/w", "/whisper"]);
const HELP = new Set(["/?", "/help"]);

/**
 * 대화창에 적은 글을 읽는다. `/r 식`·`/roll 식`은 공개 굴림, `/hr 식`은 GM에게만 보이는 비밀 굴림,
 * `/w 이름 내용`은 귓속말이다. 글이 `//`로 시작하면 앞의 슬래시 하나를 빼고 그냥 말한다.
 * 서버와 화면이 같은 규칙을 쓴다(서버가 최종 판단).
 */
export function parseChatInput(raw: string, targets: readonly ChatTarget[] = []): ChatInput {
  const text = normalizeChatText(raw);
  if (!text) return { type: "error", message: "보낼 내용을 적어 주세요." };
  if (text.startsWith("//")) return { type: "say", text: text.slice(1) };
  if (!text.startsWith("/")) return { type: "say", text };

  const space = text.search(/\s/);
  const cmd = (space < 0 ? text : text.slice(0, space)).toLowerCase();
  const rest = space < 0 ? "" : text.slice(space).trim();

  if (HELP.has(cmd)) return { type: "help" };
  if (ROLL.has(cmd) || HIDDEN_ROLL.has(cmd)) {
    if (!rest) return { type: "error", message: `주사위 식을 적어 주세요. 예: ${cmd} 1d100` };
    return { type: "roll", expr: rest, secret: HIDDEN_ROLL.has(cmd) };
  }
  if (WHISPER.has(cmd)) {
    if (!rest) return { type: "error", message: "누구에게 보낼지 적어 주세요. 예: /w 이름 내용" };
    return parseWhisper(rest, targets);
  }
  return { type: "error", message: `알 수 없는 명령이에요: ${cmd}. 도움말은 ?를 눌러 보세요.` };
}

function parseWhisper(rest: string, targets: readonly ChatTarget[]): ChatInput {
  const lower = rest.toLowerCase();
  let bestLen = 0;
  const hits = new Set<string>();
  for (const t of targets) {
    for (const name of t.names) {
      const n = name.trim().toLowerCase();
      if (!n || !lower.startsWith(n)) continue;
      const next = lower.slice(n.length, n.length + 1);
      if (next !== "" && !/\s/.test(next)) continue; // 이름 뒤는 공백이거나 끝이어야 한다
      if (n.length > bestLen) {
        bestLen = n.length;
        hits.clear();
      }
      if (n.length === bestLen) hits.add(t.userId);
    }
  }
  const firstWord = rest.split(/\s/)[0] ?? rest;
  if (hits.size === 0) return { type: "error", message: `${josa(`'${firstWord}'`, "을/를")} 찾지 못했어요. 룸에 있는 사람의 이름을 적어 주세요.` };
  if (hits.size > 1) return { type: "error", message: `${josa(`'${rest.slice(0, bestLen)}'`, "이/가")} 둘 이상이라 고를 수 없어요. 아래 받는 사람 목록에서 골라 주세요.` };
  const body = rest.slice(bestLen).trim();
  if (!body) return { type: "error", message: "보낼 내용을 적어 주세요." };
  return { type: "whisper", to: [...hits][0] as string, text: body };
}

export const CHAT_HELP_LINES: readonly string[] = [
  "/r 1d100 : 주사위를 굴려 모두에게 보여요 (/roll도 같아요)",
  "/r CC<=50 : 기능 값으로 판정해요",
  "/hr 1d100 : 굴림 결과를 GM과 나만 봐요",
  "/w 이름 내용 : 그 사람에게만 귓속말을 보내요",
  "// 로 시작하면 슬래시를 하나 빼고 그대로 말해요",
  "Enter로 보내고, Shift+Enter로 줄을 바꿔요",
];

/** 대화가 너무 길면 자를 때 쓰는 한도(서버·화면 공통) */
export const chatTooLong = (text: string) => text.length > CHAT_MAX_LENGTH;

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/**
 * 대화 기록을 웹소켓 프레임 한 개에 들어갈 크기로 나눈다(한 조각의 JSON이 maxBytes를 넘지 않는다).
 * 순서는 그대로 지키고, 한 줄만으로 maxBytes를 넘는 경우에도 그 줄은 홀로 한 조각이 된다.
 */
export function chunkChatHistory(messages: readonly ChatMessage[], maxBytes: number = CHAT_CHUNK_BYTES): ChatMessage[][] {
  const chunks: ChatMessage[][] = [];
  let cur: ChatMessage[] = [];
  let size = 0;
  for (const m of messages) {
    const b = byteLength(JSON.stringify(m)) + 1;
    if (cur.length > 0 && size + b > maxBytes) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(m);
    size += b;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

/** 이 사람이 이 대화를 볼 수 있는가. 서버가 보내는 쪽에서 쓰고, 화면은 받은 것만 그린다. */
export function canSeeChat(m: Pick<ChatMessage, "kind" | "userId" | "to">, viewer: { userId: string; role: string }): boolean {
  switch (m.kind) {
    case "say":
    case "roll":
      return true;
    case "whisper":
      // GM도 보낸 사람이나 받는 사람일 때만 본다(PL끼리의 귓속말은 보지 못한다).
      return viewer.userId === m.userId || viewer.userId === m.to?.userId;
    case "secret":
      return viewer.role === "kp" || viewer.userId === m.userId;
  }
}

/** 대화 목록에 새 메시지들을 합친다: id가 같은 것은 건너뛰고 seq 순으로 놓고, 최근 keep개만 남긴다. */
export function mergeChat(cur: readonly ChatMessage[], incoming: readonly ChatMessage[], keep: number): ChatMessage[] {
  if (incoming.length === 0) return cur as ChatMessage[];
  const seen = new Set(cur.map((m) => m.id));
  const add = incoming.filter((m) => !seen.has(m.id));
  if (add.length === 0) return cur as ChatMessage[];
  const all = [...cur, ...add].sort((a, b) => a.seq - b.seq || a.at - b.at);
  return all.length > keep ? all.slice(all.length - keep) : all;
}
