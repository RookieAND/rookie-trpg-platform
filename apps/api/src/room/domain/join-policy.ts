import type { Member, Role } from "@coc-vtt/shared";
import { DEFAULT_MAX_SPECTATORS, type RoomMeta } from "./room.repository";

export type JoinDecision =
  | { ok: true; role: Role }
  | { ok: false; reason: "no_access" | "not_owner" | "invite_expired" | "room_full" };

/**
 * 룸 입장 규칙. 주인은 항상 GM, 이미 멤버였던 사람은 원래 역할로,
 * 처음 오는 사람은 유효한 초대 코드와 남은 자리가 있어야 한다.
 * 코드가 관전 초대의 것이면 요청한 역할과 상관없이 관전자로만 들어온다.
 * PL은 주인 포함 최대 인원(maxMembers)을 지키고, 관전자는 그와 따로 관전 초대의 최대 인원을 센다.
 */
export function decideJoin(
  meta: Pick<RoomMeta, "ownerId" | "invite"> & Partial<Pick<RoomMeta, "spectatorInvite">>,
  members: Array<Pick<Member, "userId" | "role">>,
  userId: string,
  requested: Role,
  inviteCode: string | null,
  now: number,
): JoinDecision {
  if (meta.ownerId === userId) return { ok: true, role: "kp" };
  if (requested === "kp") return { ok: false, reason: "not_owner" };
  const known = members.find((m) => m.userId === userId);
  if (known) return { ok: true, role: known.role };
  const pl = meta.invite;
  const spec = meta.spectatorInvite;
  const viaSpectator = Boolean(inviteCode && spec && inviteCode === spec.code);
  const viaPl = Boolean(inviteCode && inviteCode === pl.code);
  if (!viaSpectator && !viaPl) return { ok: false, reason: "no_access" };
  const inv = viaSpectator ? spec! : pl;
  const role: Role = viaSpectator || requested === "spectator" ? "spectator" : "pl";
  if (inv.expiresAt !== null && now > inv.expiresAt) return { ok: false, reason: "invite_expired" };
  if (role === "spectator") {
    const cap = viaSpectator ? inv.maxMembers : (spec?.maxMembers ?? DEFAULT_MAX_SPECTATORS);
    if (members.filter((m) => m.role === "spectator").length >= cap) return { ok: false, reason: "room_full" };
    return { ok: true, role };
  }
  const count = new Set([meta.ownerId, ...members.filter((m) => m.role !== "spectator").map((m) => m.userId)]).size;
  if (count >= inv.maxMembers) return { ok: false, reason: "room_full" };
  return { ok: true, role };
}
