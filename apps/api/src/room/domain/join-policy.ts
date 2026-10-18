import type { Member, Role } from "@coc-vtt/shared";
import type { RoomMeta } from "./room.repository";

export type JoinDecision =
  | { ok: true; role: Role }
  | { ok: false; reason: "no_access" | "not_owner" | "invite_expired" | "room_full" };

/**
 * 룸 입장 규칙. 주인은 항상 GM, 이미 멤버였던 사람은 원래 역할로,
 * 처음 오는 사람은 유효한 초대 코드와 남은 자리가 있어야 한다.
 */
export function decideJoin(
  meta: Pick<RoomMeta, "ownerId" | "invite">,
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
  const inv = meta.invite;
  if (!inviteCode || inviteCode !== inv.code) return { ok: false, reason: "no_access" };
  if (inv.expiresAt !== null && now > inv.expiresAt) return { ok: false, reason: "invite_expired" };
  // 주인은 멤버 수에 포함한다. 관전자도 한 자리를 쓴다.
  const count = new Set([meta.ownerId, ...members.map((m) => m.userId)]).size;
  if (count >= inv.maxMembers) return { ok: false, reason: "room_full" };
  return { ok: true, role: requested };
}
