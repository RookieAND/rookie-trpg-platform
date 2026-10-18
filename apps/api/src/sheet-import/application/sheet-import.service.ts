import { googleSheetCsvUrl, isAllowedGoogleCsvTarget, parseGoogleSheetUrl } from "@coc-vtt/shared";
import { MAX_SHEET_BYTES, MAX_SHEET_REDIRECTS, SHEET_FETCH_TIMEOUT_MS, type SheetFetch, type SheetImportResult } from "../domain/sheet-import";

export interface SheetImportOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** 사람마다 windowMs 동안 maxPerWindow번까지 */
  maxPerWindow?: number;
  windowMs?: number;
  now?: () => number;
}

class Aborted extends Error {}

/** abort 신호가 오면 약속이 스스로 끝나지 않아도 곧바로 거절한다(가짜 fetch나 멈춘 스트림 대비). */
function guard<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Aborted());
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * 링크 공유된 구글 시트를 CSV로 한 번 받아 온다(읽기만, 계속 이어지지 않음).
 * 가져올 수 있는 주소는 docs.google.com의 스프레드시트 두 모양뿐이고, 리디렉션은 같은 허용 목록 안에서만 따라가며,
 * 크기(기본 1MB)와 시간(기본 8초)에 상한이 있다.
 */
export class SheetImportService {
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly doFetch: SheetFetch,
    options: SheetImportOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? MAX_SHEET_BYTES;
    this.timeoutMs = options.timeoutMs ?? SHEET_FETCH_TIMEOUT_MS;
    this.maxRedirects = options.maxRedirects ?? MAX_SHEET_REDIRECTS;
    this.maxPerWindow = options.maxPerWindow ?? 20;
    this.windowMs = options.windowMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  private allow(userId: string): boolean {
    const t = this.now();
    const hits = (this.hits.get(userId) ?? []).filter((h) => t - h < this.windowMs);
    if (hits.length >= this.maxPerWindow) {
      this.hits.set(userId, hits);
      return false;
    }
    hits.push(t);
    this.hits.set(userId, hits);
    return true;
  }

  async fetchCsv(userId: string, input: unknown): Promise<SheetImportResult> {
    const ref = typeof input === "string" ? parseGoogleSheetUrl(input) : null;
    if (!ref) return { ok: false, code: "bad_url" };
    if (!this.allow(userId)) return { ok: false, code: "rate_limited" };

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      let url = googleSheetCsvUrl(ref);
      for (let hop = 0; hop <= this.maxRedirects; hop++) {
        const res = await guard(
          ctl.signal,
          this.doFetch(url, { signal: ctl.signal, redirect: "manual", headers: { accept: "text/csv, text/plain;q=0.9", "user-agent": "night-table-sheet-import" } }),
        );
        if (res.status >= 300 && res.status < 400) {
          void res.body?.cancel().catch(() => {});
          const location = res.headers.get("location");
          let next: string | null = null;
          try {
            next = location ? new URL(location, url).toString() : null;
          } catch {
            next = null;
          }
          if (!next) return { ok: false, code: "upstream" };
          if (!isAllowedGoogleCsvTarget(next)) {
            // 공유가 안 된 시트는 구글 로그인 쪽으로 보낸다.
            return { ok: false, code: new URL(next).hostname === "accounts.google.com" ? "not_shared" : "redirect" };
          }
          url = next;
          continue;
        }
        if (res.status === 401 || res.status === 403) return { ok: false, code: "not_shared" };
        if (res.status === 404 || res.status === 410) return { ok: false, code: "not_found" };
        if (!res.ok) return { ok: false, code: "upstream" };

        const type = (res.headers.get("content-type") ?? "").toLowerCase();
        if (type.includes("html")) {
          void res.body?.cancel().catch(() => {});
          return { ok: false, code: "not_shared" };
        }
        const declared = Number(res.headers.get("content-length") ?? 0);
        if (declared > this.maxBytes) {
          void res.body?.cancel().catch(() => {});
          return { ok: false, code: "too_large" };
        }
        const body = await guard(ctl.signal, this.readLimited(res));
        if (body === "too_large") return { ok: false, code: "too_large" };
        if (/^\s*<(?:!doctype html|html)/i.test(body)) return { ok: false, code: "not_shared" };
        if (body.trim() === "") return { ok: false, code: "not_csv" };
        return { ok: true, csv: body };
      }
      return { ok: false, code: "upstream" };
    } catch (e) {
      return { ok: false, code: e instanceof Aborted || ctl.signal.aborted ? "timeout" : "upstream" };
    } finally {
      clearTimeout(timer);
    }
  }

  private async readLimited(res: Response): Promise<string | "too_large"> {
    if (!res.body) {
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length > this.maxBytes ? "too_large" : buf.toString("utf8");
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxBytes) {
        void reader.cancel().catch(() => {});
        return "too_large";
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
}
