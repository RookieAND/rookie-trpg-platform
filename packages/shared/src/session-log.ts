import { LOG_KIND_LABEL_KO, LOG_KINDS, type LogEntry, type LogEntryView, type LogKind } from "./protocol";
import { clock } from "./roll-log-export";

/** 기록을 보는 사람. 모두 볼 수 있는 기록만 보고 싶으면 userId를 빈 글로, role을 "pl"로 준다. */
export interface LogViewer {
  userId: string;
  role: string;
}

/** GM은 기록된 것을 모두 본다. 나머지는 모두에게 공개된 기록과, 자기가 받는 대상에 든 기록만 본다. */
export function canSeeLog(e: Pick<LogEntry, "audience">, viewer: LogViewer): boolean {
  if (viewer.role === "kp") return true;
  if (e.audience === "all") return true;
  if (e.audience === "gm") return false;
  return viewer.userId !== "" && e.audience.includes(viewer.userId);
}

/** 보는 사람에게 내보낼 모양으로 바꾼다(공개 범위·가린 글 반영, 사용자 id 제거). */
export function logViewOf(e: LogEntry, viewer: LogViewer): LogEntryView {
  const gm = viewer.role === "kp";
  return {
    n: e.n,
    at: e.at,
    session: e.session,
    kind: e.kind,
    type: e.type,
    text: gm ? e.text : (e.plText ?? e.text),
    ...(e.scene ? { scene: e.scene } : {}),
    ...(e.roll ? { roll: { ...e.roll, tags: [...e.roll.tags] } } : {}),
    ...(e.chat ? { chat: { ...e.chat } } : {}),
    ...(gm && e.audience !== "all" ? { scope: e.audience === "gm" ? ("gm" as const) : ("some" as const) } : {}),
  };
}

export interface LogQuery {
  kinds?: readonly LogKind[];
  since?: number;
  until?: number;
  session?: number;
  /** 이 번호보다 앞의 기록만(이전 기록 더 보기) */
  before?: number;
  /** 한 번에 돌려줄 수(최근 것부터 이만큼). 기본 200 */
  limit?: number;
}

export interface LogPage {
  entries: LogEntryView[];
  /** 이 조건에 맞는 기록 전체 수(보는 사람이 볼 수 있는 것만) */
  total: number;
  /** 더 오래된 기록이 남았는가 */
  hasMore: boolean;
}

export const LOG_PAGE_DEFAULT = 200;
export const LOG_PAGE_MAX = 500;

/** 보는 사람이 볼 수 있는 기록 중 조건에 맞는 것을 오래된 순으로, 최근 limit개만 돌려준다. */
export function queryLog(entries: readonly LogEntry[], viewer: LogViewer, q: LogQuery = {}): LogPage {
  const kinds = q.kinds && q.kinds.length > 0 ? new Set<LogKind>(q.kinds) : null;
  const matched = entries.filter(
    (e) =>
      canSeeLog(e, viewer) &&
      (!kinds || kinds.has(e.kind)) &&
      (q.since === undefined || e.at >= q.since) &&
      (q.until === undefined || e.at <= q.until) &&
      (q.session === undefined || e.session === q.session),
  );
  const older = q.before === undefined ? matched : matched.filter((e) => e.n < q.before!);
  const limit = Math.min(Math.max(1, Math.floor(q.limit ?? LOG_PAGE_DEFAULT)), LOG_PAGE_MAX);
  const page = older.slice(Math.max(0, older.length - limit));
  return { entries: page.map((e) => logViewOf(e, viewer)), total: matched.length, hasMore: older.length > page.length };
}

export const isLogKind = (v: string): v is LogKind => (LOG_KINDS as readonly string[]).includes(v);

// ── 내보내기 ──────────────────────────────────────────────

export const SESSION_LOG_FORMAT = "coc-vtt-session-log";
export const SESSION_LOG_VERSION = 1;

export interface SessionLogExportOptions {
  title: string;
  /** GM용(숨은 기록 포함)인지, 참가자용인지 */
  audience: "gm" | "public";
  /** 내보낸 시각(ms) */
  exportedAt: number;
  /** 시각 표시에 쓸 시간대(기본은 실행 환경의 시간대) */
  timeZone?: string;
}

const dateOf = (at: number, timeZone?: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

const timeOf = (at: number, timeZone?: string) => clock(at, timeZone).slice(6); // "MM/DD HH:mm" → "HH:mm"

/** 표의 칸에 넣을 글: 세로줄과 줄바꿈을 없앤다. */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

/** 마크다운 줄 머리의 기호가 의도치 않게 서식이 되지 않도록 한 줄 글로 만든다. */
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ");

/** JSON으로 내보낼 글 */
export function sessionLogJson(entries: readonly LogEntryView[], opts: SessionLogExportOptions): string {
  return JSON.stringify(
    {
      format: SESSION_LOG_FORMAT,
      version: SESSION_LOG_VERSION,
      title: opts.title,
      audience: opts.audience,
      exportedAt: new Date(opts.exportedAt).toISOString(),
      count: entries.length,
      entries,
    },
    null,
    2,
  );
}

/**
 * 세션 기록을 플레이 보고서 같은 마크다운으로 만든다. 세션(날짜)마다, 그 안에서 장면마다 구획을 나누고
 * 구획 안은 진행 → 굴림 표 → 대화 발췌 순서다. 이미 보는 사람에게 맞게 걸러진 기록만 받으므로 여기서 더 가리지는 않는다.
 */
export function formatSessionLog(entries: readonly LogEntryView[], opts: SessionLogExportOptions): string {
  const tz = opts.timeZone;
  const lines: string[] = [`# ${opts.title.trim() || "세션 기록"}`, ""];
  lines.push(opts.audience === "gm" ? "> GM용 기록이에요. 참가자에게 보이지 않는 내용이 들어 있어요." : "> 참가자에게 보이는 내용만 담았어요. GM만 아는 내용은 들어 있지 않아요.");
  lines.push(`> 내보낸 때: ${dateOf(opts.exportedAt, tz)} ${timeOf(opts.exportedAt, tz)}`, "");
  if (entries.length === 0) {
    lines.push("기록이 없어요.");
    return lines.join("\n") + "\n";
  }

  const sorted = [...entries].sort((a, b) => a.n - b.n);
  // 세션 → 장면(이어진 구간) 순서로 묶는다.
  interface Block {
    session: number;
    scene: string;
    items: LogEntryView[];
  }
  const blocks: Block[] = [];
  for (const e of sorted) {
    const scene = e.scene ?? "";
    const last = blocks.at(-1);
    if (last && last.session === e.session && last.scene === scene) last.items.push(e);
    else blocks.push({ session: e.session, scene, items: [e] });
  }

  let session: number | null = null;
  for (const b of blocks) {
    if (b.session !== session) {
      session = b.session;
      const first = b.items[0] as LogEntryView;
      lines.push(b.session > 0 ? `## 세션 ${b.session} · ${dateOf(first.at, tz)}` : `## 세션 시작 전 · ${dateOf(first.at, tz)}`, "");
    }
    if (b.scene) lines.push(`### ${oneLine(b.scene)}`, "");
    const events = b.items.filter((e) => e.kind !== "roll" && e.kind !== "chat");
    const rolls = b.items.filter((e) => e.kind === "roll" && e.roll);
    const chats = b.items.filter((e) => e.kind === "chat" && e.chat);
    for (const e of events) lines.push(`- ${timeOf(e.at, tz)} ${oneLine(e.text)}${e.scope ? " (GM 전용)" : ""}`);
    if (events.length) lines.push("");
    if (rolls.length) {
      lines.push("**굴림**", "", "| 시각 | 누가 | 식 | 결과 |", "| --- | --- | --- | --- |");
      for (const e of rolls) {
        const r = e.roll!;
        lines.push(`| ${timeOf(r.at, tz)} | ${cell(r.who)} | \`${cell(r.expr)}\` | ${cell(r.result)}${r.tags.length ? ` (${r.tags.join(", ")})` : ""} |`);
      }
      lines.push("");
    }
    if (chats.length) {
      lines.push("**대화 발췌**", "");
      for (const e of chats) {
        const c = e.chat!;
        const body = c.text.split("\n").map((l) => l.trim()).filter(Boolean);
        lines.push(`> ${timeOf(e.at, tz)} **${oneLine(c.name)}** ${body.join(" / ")}`, ">");
      }
      lines.pop(); // 마지막 빈 인용줄
      lines.push("");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** 필터 이름 표시에 쓴다. */
export const logKindLabel = (k: LogKind) => LOG_KIND_LABEL_KO[k];
