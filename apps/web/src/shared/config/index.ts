export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
export const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:8787/ws";
/** 설정돼 있으면 디스코드 로그인(Supabase)을 쓰고, 없으면 개발용 이름 로그인을 쓴다. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
/** 토큰 갱신 요청에 쓰는 Supabase 공개(anon) 키. 로그인 토큰 갱신에만 필요하다. */
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** 서비스 이름. 화면 곳곳과 브라우저 탭 제목이 이 값을 쓴다. */
export const SERVICE_NAME = "밤의 탁자";
