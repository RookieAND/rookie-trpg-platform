import { http, type Caller } from "@/shared/api";
import type { DiscordSettings, Invite, RoomListItem, RoomPreview } from "../model/types";

export const listRooms = (me: Caller) => http<RoomListItem[]>(me, "GET", "/rooms");

export const createRoom = (me: Caller, name: string) =>
  http<{ id: string; name: string; invite: Invite }>(me, "POST", "/rooms", { name });

export const getRoom = (me: Caller, id: string, invite?: string) =>
  http<RoomPreview>(me, "GET", `/rooms/${encodeURIComponent(id)}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`);

export const regenerateInvite = (me: Caller, id: string, opts: { expiresInMinutes?: number | null; maxMembers?: number } = {}) =>
  http<Invite>(me, "POST", `/rooms/${encodeURIComponent(id)}/invite`, opts);

/** 룸 주인 전용. 웹훅 주소는 서버가 다시 돌려주지 않으므로 연결 여부와 알림 종류만 받는다. */
export const getDiscord = async (me: Caller, id: string): Promise<DiscordSettings> => {
  const room = await http<{ discord?: DiscordSettings }>(me, "GET", `/rooms/${encodeURIComponent(id)}`);
  return room.discord ?? { connected: false, events: { session: true, rolls: true } };
};

export const saveDiscord = (me: Caller, id: string, webhookUrl: string | null | undefined, events: DiscordSettings["events"]) =>
  http<DiscordSettings>(me, "PUT", `/rooms/${encodeURIComponent(id)}/discord`, { webhookUrl, events });

export const testDiscord = (me: Caller, id: string) => http<{ ok: true }>(me, "POST", `/rooms/${encodeURIComponent(id)}/discord/test`);

/** 룸 주인 전용. 되돌릴 수 없다. */
export const deleteRoom = (me: Caller, id: string) => http<null>(me, "DELETE", `/rooms/${encodeURIComponent(id)}`);
