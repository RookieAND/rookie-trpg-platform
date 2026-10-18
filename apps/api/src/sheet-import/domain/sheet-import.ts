/** 구글 시트 가져오기의 포트와 결과. 서버가 대신 가져오는 것은 링크 공유된 시트의 CSV 하나뿐이다. */

export const MAX_SHEET_BYTES = 1_000_000;
export const SHEET_FETCH_TIMEOUT_MS = 8_000;
export const MAX_SHEET_REDIRECTS = 3;

/** 바깥으로 나가는 요청. 운영에서는 전역 fetch이고, 테스트에서는 가짜로 바꿔 끼운다(네트워크를 쓰지 않는다). */
export type SheetFetch = (url: string, init: { signal: AbortSignal; redirect: "manual"; headers: Record<string, string> }) => Promise<Response>;

export type SheetImportCode = "bad_url" | "not_shared" | "not_found" | "not_csv" | "too_large" | "timeout" | "upstream" | "redirect" | "rate_limited";
export type SheetImportResult = { ok: true; csv: string } | { ok: false; code: SheetImportCode };
