import { CHAT_KEEP, DEFAULT_CHAT_SETTINGS, LOG_KEEP, LOG_KINDS, MAX_BANNED, sanitizeDisplayName, sanitizeMarkers, type BannedUser, type ChatMessage, type GameObject, type LogEntry } from "@coc-vtt/shared";
import type { RoomData } from "./room";

/**
 * 저장하는 룸 데이터의 모양 번호.
 *  1: 번호가 없던 옛 모양(대화·세션 기록이 없다)
 *  2: 대화(chat, chatSettings)와 세션 기록(log)이 생겼다
 *  3: 토큰 상태 표식(objects[].markers)과 관전자 대화 설정(chatSettings.spectatorChat)이 생겼다
 *  4: 차단 목록(banned)과 "PL이 자기 수치 직접 수정" 설정(chatSettings.plSelfEdit, 없으면 켜짐)이 생겼다
 * 새 필드는 늘 "없으면 기본값"으로 읽는다. 그래서 옛 데이터는 그대로 열리고, 더 새로운 번호의 데이터도 아는 필드만 읽어 열린다.
 */
export const ROOM_SCHEMA_VERSION = 4;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const validChat = (m: unknown): m is ChatMessage =>
  isObj(m) &&
  str(m.id) &&
  num(m.seq) &&
  num(m.at) &&
  str(m.userId) &&
  str(m.name) &&
  str(m.text) &&
  (m.kind === "say" || m.kind === "roll" || m.kind === "whisper" || m.kind === "secret") &&
  (m.kind !== "whisper" || (isObj(m.to) && str(m.to.userId)));

const validLog = (e: unknown): e is LogEntry =>
  isObj(e) &&
  num(e.n) &&
  num(e.at) &&
  str(e.text) &&
  str(e.type) &&
  (LOG_KINDS as readonly string[]).includes(e.kind as string) &&
  (e.audience === "all" || e.audience === "gm" || (Array.isArray(e.audience) && e.audience.every(str)));

const validBan = (b: unknown): b is BannedUser => isObj(b) && str(b.userId) && b.userId.length > 0 && b.userId.length <= 64 && str(b.name) && num(b.at);

/** 오브젝트의 표식에서 모양이 깨진 것을 버린다(모르는 key는 새 버전이 쓴 것이라 남긴다). */
const cleanMarkers = (o: GameObject): GameObject => {
  if (!isObj(o) || o.markers === undefined) return o;
  const { markers: raw, ...rest } = o;
  const markers = sanitizeMarkers(raw);
  return markers.length ? { ...rest, markers } : rest;
};

/**
 * 저장된 룸 데이터를 지금 모양으로 맞춘다. 모르는 필드는 그대로 두고, 없는 필드는 기본값으로 채우며,
 * 모양이 깨진 대화·기록 한 줄은 버린다(룸 전체를 못 여는 일이 없게). 룸의 기본 정보(roomId)가 없으면 오류다.
 */
export function migrateRoomData(raw: unknown): RoomData {
  if (!isObj(raw) || !str(raw.roomId)) throw new Error("룸 데이터를 읽을 수 없어요.");
  const d = raw as unknown as RoomData & Record<string, unknown>;
  const chat = (Array.isArray(d.chat) ? d.chat.filter(validChat) : []).slice(-CHAT_KEEP);
  const log = (Array.isArray(d.log) ? d.log.filter(validLog) : []).slice(-LOG_KEEP);
  const cs: Record<string, unknown> = isObj(d.chatSettings) ? d.chatSettings : {};
  return {
    ...d,
    schemaVersion: ROOM_SCHEMA_VERSION,
    objects: Array.isArray(d.objects) ? d.objects.map(cleanMarkers) : [],
    members: Array.isArray(d.members) ? d.members : [],
    rolls: Array.isArray(d.rolls) ? d.rolls : [],
    chat,
    chatSettings: { ...DEFAULT_CHAT_SETTINGS, plWhisper: cs.plWhisper === true, spectatorChat: cs.spectatorChat === true, plSelfEdit: cs.plSelfEdit !== false },
    log,
    banned: (Array.isArray(d.banned) ? d.banned.filter(validBan) : []).slice(0, MAX_BANNED).map((b) => ({ userId: b.userId, name: sanitizeDisplayName(b.name), at: b.at })),
  };
}
