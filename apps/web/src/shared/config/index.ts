import { deriveRealtimeUrl, normalizeBaseUrl } from "./urls";

// NEXT_PUBLIC_* 값은 빌드할 때 번들에 박힌다. 바꾸려면 다시 빌드(배포)해야 한다. docs/deploy-env.md 참고.
export const API_URL = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787");
/** 비워 두면 API_URL에서 만든다(https → wss). */
export const REALTIME_URL = deriveRealtimeUrl(API_URL, process.env.NEXT_PUBLIC_REALTIME_URL);
/** 설정돼 있으면 디스코드 로그인(Supabase)을 쓰고, 없으면 개발용 이름 로그인을 쓴다. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
/** 토큰 갱신 요청에 쓰는 Supabase 공개(anon) 키. 로그인 토큰 갱신에만 필요하다. */
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** 서비스 이름. 화면 곳곳과 브라우저 탭 제목이 이 값을 쓴다. */
export const SERVICE_NAME = "밤의 탁자";

export { secureRealtimeUrl } from "./urls";
