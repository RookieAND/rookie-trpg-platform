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
  invite?: Invite;
}

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  IDLE: "대기",
  ACTIVE: "진행 중",
  PAUSED: "일시정지",
};

export const ROLE_LABEL: Record<RoomRole, string> = { kp: "KP", pl: "PL", spectator: "관전자" };

export interface DiscordSettings {
  connected: boolean;
  events: { session: boolean; rolls: boolean };
}
