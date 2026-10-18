import { SUPABASE_URL } from "@/shared/config";
import type { Identity } from "./identity";

const RETURN_KEY = "coc-vtt.return-to";

/** 로그인 뒤에 돌아올 주소(내부 경로만)를 기억한다. 초대 링크에서 로그인해도 초대가 이어지게 한다. */
const remember = (path: string) => {
  try {
    sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    /* 없으면 로비로 돌아간다 */
  }
};

/** 돌아올 주소를 한 번만 꺼낸다. 같은 사이트 안의 경로가 아니면 버린다(오픈 리다이렉트 방지). */
export function consumeReturnTo(): string {
  try {
    const v = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    if (v && v.startsWith("/") && !v.startsWith("//")) return v;
  } catch {
    /* ignore */
  }
  return "/";
}

/** Supabase의 디스코드 로그인으로 보낸다. */
export function beginDiscordLogin() {
  if (!SUPABASE_URL) return;
  remember(window.location.pathname + window.location.search);
  const redirect = encodeURIComponent(`${window.location.origin}/auth/callback`);
  window.location.assign(`${SUPABASE_URL}/auth/v1/authorize?provider=discord&redirect_to=${redirect}`);
}

const decodePayload = (jwt: string): Record<string, unknown> | null => {
  try {
    const part = jwt.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
};

/** 액세스 토큰(과 갱신 토큰)에서 화면에 쓸 신원을 만든다. 서명은 서버가 검증하므로 이름과 만료 시각만 읽는다. */
export function sessionFromTokens(token: string, refreshToken?: string | null): Identity | null {
  const claims = decodePayload(token);
  const sub = typeof claims?.sub === "string" ? claims.sub : null;
  if (!sub) return null;
  const meta = (claims?.user_metadata ?? {}) as { full_name?: string; name?: string; custom_claims?: { global_name?: string } };
  const name = meta.custom_claims?.global_name ?? meta.full_name ?? meta.name ?? "이름 없음";
  const exp = typeof claims?.exp === "number" ? claims.exp : undefined;
  return { userId: sub, name: name.slice(0, 40), token, expiresAt: exp, ...(refreshToken ? { refreshToken } : {}) };
}

/** 로그인 뒤 주소의 `#access_token=…&refresh_token=…`에서 세션을 만든다. */
export function sessionFromCallbackHash(hash: string): Identity | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const token = q.get("access_token");
  if (!token) return null;
  return sessionFromTokens(token, q.get("refresh_token"));
}
