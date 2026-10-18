import type { FogArea, Member } from "@coc-vtt/shared";

/** 사용자당 초당 핑 횟수 */
export const PINGS_PER_SECOND = 2;

/** 안개 원 안의 좌표인가. 안개가 없으면(areas가 undefined) 어디든 보인다. */
export function pointVisible(areas: FogArea[] | undefined, x: number, y: number): boolean {
  if (!areas) return true;
  return areas.some((a) => (a.x - x) ** 2 + (a.y - y) ** 2 <= a.r ** 2);
}

/**
 * 핑을 받을 사람. GM은 늘 받고, 나머지는 그 자리가 보일 때만 받는다(안개 속 위치가 새지 않게).
 * 핑한 사람은 제 화면에 바로 보이도록 늘 받는다.
 */
export function pingRecipients(members: Iterable<Pick<Member, "userId" | "role">>, areas: FogArea[] | undefined, x: number, y: number, senderId: string): string[] {
  const visible = pointVisible(areas, x, y);
  const out: string[] = [];
  for (const m of members) if (m.role === "kp" || m.userId === senderId || visible) out.push(m.userId);
  return out;
}
