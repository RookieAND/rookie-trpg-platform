import type { IncomingMessage } from "node:http";
import { sanitizeDisplayName, type Role } from "@coc-vtt/shared";
import type { Authenticate } from "../domain/identity";
import type { VerifyToken } from "./jwt-verifier";

const bearer = (req: IncomingMessage) => {
  const v = req.headers.authorization;
  const h = Array.isArray(v) ? v[0] : v;
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : undefined;
};

/**
 * Supabase 로그인(디스코드 OAuth) 토큰으로 신원을 읽는다. HTTP와 웹소켓이 같은 함수를 쓴다.
 * 토큰은 Authorization 헤더, 웹소켓은 헤더를 못 실으니 `token` 쿼리로 받는다.
 * 이름은 디스코드 표시 이름 → 사용자명 순으로 쓴다.
 */
export const supabaseAuthenticate =
  (verify: VerifyToken): Authenticate =>
  async (req, url) => {
    const token = bearer(req) ?? url.searchParams.get("token") ?? undefined;
    if (!token) return null;
    const claims = await verify(token);
    if (!claims?.sub) return null;
    const m = claims.user_metadata ?? {};
    const name = m.custom_claims?.global_name ?? m.full_name ?? m.name ?? m.user_name ?? "이름 없음";
    const role = url.searchParams.get("role");
    const requestedRole: Role = role === "kp" || role === "spectator" ? role : "pl";
    return { userId: claims.sub, name: sanitizeDisplayName(name), requestedRole, ...(typeof claims.exp === "number" ? { expiresAt: claims.exp * 1000 } : {}) };
  };
