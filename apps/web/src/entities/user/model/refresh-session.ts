import { sessionFromTokens } from "./discord-login";
import type { Identity } from "./identity";

export type RefreshResult =
  | { status: "ok"; identity: Identity }
  /** 갱신 토큰이 없거나 거절당함 — 다시 로그인해야 한다. */
  | { status: "invalid" }
  /** 네트워크 문제 등으로 확인하지 못함 — 잠시 뒤 다시 시도할 수 있다. */
  | { status: "unreachable" };

export interface RefreshDeps {
  supabaseUrl: string;
  /** Supabase 공개(anon) 키. 인증 서버가 apikey 헤더로 요구한다. */
  anonKey?: string;
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
}

/**
 * 저장된 갱신 토큰으로 새 세션을 받는다(Supabase `grant_type=refresh_token`). 네트워크와 저장소를 모르는
 * 순수 함수라 가짜 fetch로 시험한다. 응답은 갱신 토큰도 새로 돌려주므로(회전) 호출한 쪽이 반드시 저장해야 한다.
 */
export async function refreshSession(stored: Identity, deps: RefreshDeps): Promise<RefreshResult> {
  if (!stored.refreshToken) return { status: "invalid" };
  let res;
  try {
    res = await deps.fetch(`${deps.supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(deps.anonKey ? { apikey: deps.anonKey } : {}) },
      body: JSON.stringify({ refresh_token: stored.refreshToken }),
    });
  } catch {
    return { status: "unreachable" };
  }
  if (!res.ok) return res.status >= 500 || res.status === 429 ? { status: "unreachable" } : { status: "invalid" };
  let body: { access_token?: unknown; refresh_token?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { status: "unreachable" };
  }
  if (typeof body.access_token !== "string") return { status: "invalid" };
  const next = sessionFromTokens(body.access_token, typeof body.refresh_token === "string" ? body.refresh_token : stored.refreshToken);
  // 다른 사람의 토큰이 오면 받지 않는다.
  if (!next || next.userId !== stored.userId) return { status: "invalid" };
  return { status: "ok", identity: next };
}
