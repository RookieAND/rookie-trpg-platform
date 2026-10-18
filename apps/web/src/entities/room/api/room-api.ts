import { http, httpDownload, httpText, type Caller } from "@/shared/api";
import type { ScenarioCounts } from "@coc-vtt/shared";
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

/** 룸 주인 전용. 룸 이름을 바꾼다. */
export const renameRoom = (me: Caller, id: string, name: string) => http<{ id: string; name: string }>(me, "PATCH", `/rooms/${encodeURIComponent(id)}`, { name });

export interface ScenarioImportResult {
  dryRun: boolean;
  importId: string;
  counts: ScenarioCounts;
  warnings: string[];
  reusedScene: boolean;
  roomName?: string;
}

/** 룸 주인 전용. 시나리오·백업 파일 글을 이 룸에 더한다. dryRun이면 검사만 하고 개수와 경고를 알려 준다. */
export const importScenario = (me: Caller, id: string, text: string, dryRun: boolean) =>
  httpText<ScenarioImportResult>(me, "POST", `/rooms/${encodeURIComponent(id)}/scenario${dryRun ? "?dryRun=1" : ""}`, text);

/** 파일 글로 새 룸을 만든다. 만든 사람이 GM이다. */
export const importNewRoom = (me: Caller, text: string, name?: string) =>
  httpText<{ id: string; name: string; counts: ScenarioCounts; warnings: string[] }>(me, "POST", `/rooms/import${name ? `?name=${encodeURIComponent(name)}` : ""}`, text);

/** 룸 주인 전용. 룸을 시나리오 파일(scenario) 또는 설정까지 담은 백업(backup)으로 받는다. */
export const exportRoom = (me: Caller, id: string, format: "scenario" | "backup", sheets: boolean) =>
  httpDownload(me, `/rooms/${encodeURIComponent(id)}/export?format=${format}${sheets ? "&sheets=1" : ""}`);
