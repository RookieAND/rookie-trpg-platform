import type { IncomingMessage } from "node:http";
import type { Role } from "@coc-vtt/shared";
import type { Authenticate } from "../domain/identity";

const header = (req: IncomingMessage, name: string) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** HTTP 헤더에는 한글을 바로 실을 수 없어 퍼센트 인코딩으로 받는다. */
const decode = (v: string | undefined) => {
  if (v === undefined) return undefined;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

/**
 * 개발용 인증. 쿼리(user, name, role)나 헤더(x-dev-user, x-dev-name)로 신원을 받는다.
 * 운영에서는 Supabase 토큰을 검증하는 구현으로 교체한다.
 */
export const devAuthenticate: Authenticate = (req, url) => {
  const userId = url.searchParams.get("user") ?? decode(header(req, "x-dev-user"));
  const name = url.searchParams.get("name") ?? decode(header(req, "x-dev-name")) ?? userId;
  const role = url.searchParams.get("role");
  if (!userId || !name) return null;
  const requestedRole: Role = role === "kp" || role === "spectator" ? role : "pl";
  return { userId: userId.slice(0, 64), name: name.slice(0, 40), requestedRole };
};
