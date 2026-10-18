import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/shared/config";
import { clearIdentity, loadStoredSession, saveSession } from "./identity";
import { refreshSession, type RefreshResult } from "./refresh-session";

let inflight: Promise<RefreshResult> | null = null;

/**
 * 이 브라우저에 저장된 디스코드 로그인 세션을 갱신해 저장한다. 갱신 토큰은 한 번 쓰면 바뀌므로
 * 동시에 여러 번 부르면 하나만 보낸다. 거절당하면(만료·취소) 저장된 로그인을 지운다.
 * 개발용 로그인(SUPABASE_URL 없음)에서는 아무것도 하지 않는다.
 */
export function refreshStoredSession(): Promise<RefreshResult> {
  if (!SUPABASE_URL) return Promise.resolve({ status: "invalid" });
  inflight ??= (async () => {
    const stored = loadStoredSession();
    if (!stored) return { status: "invalid" } as const;
    const r = await refreshSession(stored, { supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, fetch: (url, init) => fetch(url, init) });
    if (r.status === "ok") saveSession(r.identity);
    else if (r.status === "invalid") clearIdentity();
    return r;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
