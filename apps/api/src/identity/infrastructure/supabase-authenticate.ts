import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Role } from "@coc-vtt/shared";
import type { Authenticate } from "../domain/identity";

interface Claims {
  sub?: string;
  exp?: number;
  aud?: string | string[];
  role?: string;
  user_metadata?: { full_name?: string; name?: string; user_name?: string; custom_claims?: { global_name?: string } };
}

const b64 = (s: string) => Buffer.from(s, "base64url");

/** HS256으로 서명된 Supabase 액세스 토큰을 검증한다. 맞으면 claims, 아니면 null. */
export function verifyJwt(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts as [string, string, string];
  try {
    const header = JSON.parse(b64(h).toString("utf8")) as { alg?: string };
    if (header.alg !== "HS256") return null; // alg=none 등 다른 방식은 받지 않는다.
    const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
    const given = b64(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const claims = JSON.parse(b64(p).toString("utf8")) as Claims;
    if (typeof claims.exp !== "number" || claims.exp <= nowSec) return null;
    if (!claims.sub) return null;
    return claims;
  } catch {
    return null;
  }
}

const bearer = (req: IncomingMessage) => {
  const v = req.headers.authorization;
  const h = Array.isArray(v) ? v[0] : v;
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : undefined;
};

/**
 * Supabase 로그인(디스코드 OAuth) 토큰으로 신원을 읽는다.
 * 토큰은 Authorization 헤더, 웹소켓은 헤더를 못 실으니 `token` 쿼리로 받는다.
 * 이름은 디스코드 표시 이름 → 사용자명 순으로 쓴다.
 */
export const supabaseAuthenticate =
  (jwtSecret: string, now?: () => number): Authenticate =>
  (req, url) => {
    const token = bearer(req) ?? url.searchParams.get("token") ?? undefined;
    if (!token) return null;
    const claims = verifyJwt(token, jwtSecret, now?.());
    if (!claims?.sub) return null;
    const m = claims.user_metadata ?? {};
    const name = m.custom_claims?.global_name ?? m.full_name ?? m.name ?? m.user_name ?? "이름 없음";
    const role = url.searchParams.get("role");
    const requestedRole: Role = role === "kp" || role === "spectator" ? role : "pl";
    return { userId: claims.sub, name: name.slice(0, 40), requestedRole };
  };
