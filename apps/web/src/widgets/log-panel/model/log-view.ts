import { LOG_PAGE_MAX, formatSessionLog, sessionLogJson, type LogEntryView, type LogKind } from "@coc-vtt/shared";
import type { SessionLogPage, SessionLogQuery } from "@/entities/room";

/** datetime-local 값("2026-10-18T21:30")을 ms로. 비었거나 잘못되면 undefined */
export function parseLocalTime(v: string): number | undefined {
  if (!v) return undefined;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : undefined;
}

export interface LogFilter {
  kinds: LogKind[];
  /** 0이면 전체 */
  session: number;
  since: string;
  until: string;
}

export const EMPTY_FILTER: LogFilter = { kinds: [], session: 0, since: "", until: "" };

export function filterToQuery(f: LogFilter, view?: "public"): SessionLogQuery {
  const since = parseLocalTime(f.since);
  const until = parseLocalTime(f.until);
  return {
    ...(f.kinds.length ? { kinds: f.kinds } : {}),
    ...(f.session > 0 ? { session: f.session } : {}),
    ...(since !== undefined ? { since } : {}),
    // 분 단위로 고른 끝 시각은 그 분이 끝날 때까지 포함한다.
    ...(until !== undefined ? { until: until + 59_999 } : {}),
    ...(view ? { view } : {}),
  };
}

export const toggleKind = (kinds: readonly LogKind[], k: LogKind): LogKind[] => (kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]);

/** 페이지를 끝까지 넘기며 모두 모은다(오래된 순). 안전장치로 쪽 수를 제한한다. */
export async function fetchAllLog(fetchPage: (q: SessionLogQuery) => Promise<SessionLogPage>, base: SessionLogQuery = {}, maxPages = 20): Promise<{ entries: LogEntryView[]; audience: "gm" | "public"; complete: boolean }> {
  let all: LogEntryView[] = [];
  let before: number | undefined;
  let audience: "gm" | "public" = "public";
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage({ ...base, limit: LOG_PAGE_MAX, ...(before !== undefined ? { before } : {}) });
    audience = page.audience;
    all = [...page.entries, ...all];
    if (!page.hasMore || page.entries.length === 0) return { entries: all, audience, complete: true };
    before = page.entries[0]!.n;
  }
  return { entries: all, audience, complete: false };
}

export const stamp = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

export function buildExport(kind: "md" | "json", entries: LogEntryView[], o: { title: string; audience: "gm" | "public"; now: Date }) {
  const opts = { title: o.title, audience: o.audience, exportedAt: o.now.getTime() };
  const base = `session-log-${o.audience === "gm" ? "gm" : "public"}-${stamp(o.now)}`;
  return kind === "md"
    ? { filename: `${base}.md`, text: formatSessionLog(entries, opts), mime: "text/markdown;charset=utf-8" }
    : { filename: `${base}.json`, text: sessionLogJson(entries, opts), mime: "application/json;charset=utf-8" };
}
