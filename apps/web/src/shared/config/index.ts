export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
export const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:8787/ws";
/** 설정돼 있으면 디스코드 로그인(Supabase)을 쓰고, 없으면 개발용 이름 로그인을 쓴다. */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
