export type RoomRole = "kp" | "pl" | "spectator";
export type SessionStatus = "IDLE" | "ACTIVE" | "PAUSED";

export interface RoomListItem {
  id: string;
  name: string;
  role: RoomRole | null;
  sessionStatus: SessionStatus;
  sessionNumber: number;
  online: number;
}

export interface Invite {
  code: string;
  expiresAt: number | null;
  maxMembers: number;
}

export interface RoomPreview {
  id: string;
  name: string;
  status: SessionStatus;
  sessionNumber: number;
  online: number;
  role: RoomRole | null;
  /** 이 링크로 들어가면 되는 역할(관전 링크면 spectator). 옛 서버에는 없다. */
  joinAs?: RoomRole;
  invite?: Invite;
  /** 관전(읽기 전용) 초대. 주인에게만 오고, 만들기 전에는 null */
  spectatorInvite?: Invite | null;
}

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  IDLE: "대기",
  ACTIVE: "진행 중",
  PAUSED: "일시정지",
};

export const ROLE_LABEL: Record<RoomRole, string> = { kp: "GM", pl: "PL", spectator: "관전자" };

export interface DiscordSettings {
  connected: boolean;
  events: { session: boolean; rolls: boolean };
}
