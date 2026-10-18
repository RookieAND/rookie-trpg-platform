import { describe, expect, it } from "vitest";
import type { LogEntryView } from "@coc-vtt/shared";
import { EMPTY_FILTER, buildExport, fetchAllLog, filterToQuery, parseLocalTime, toggleKind } from "./log-view";

const e = (n: number): LogEntryView => ({ n, at: 1_700_000_000_000 + n * 1000, session: 1, kind: "session", type: "x", text: `줄 ${n}` });

describe("filterToQuery", () => {
  it("빈 필터는 빈 조건", () => {
    expect(filterToQuery(EMPTY_FILTER)).toEqual({});
  });
  it("종류·세션·시간·참가자용 보기", () => {
    const q = filterToQuery({ kinds: ["roll"], session: 2, since: "2026-10-18T20:00", until: "2026-10-18T21:00" }, "public");
    expect(q.kinds).toEqual(["roll"]);
    expect(q.session).toBe(2);
    expect(q.view).toBe("public");
    expect(q.until! - q.since!).toBe(3_600_000 + 59_999);
  });
  it("잘못된 시각은 무시", () => {
    expect(parseLocalTime("abc")).toBeUndefined();
    expect(parseLocalTime("")).toBeUndefined();
  });
});

it("toggleKind", () => {
  expect(toggleKind([], "roll")).toEqual(["roll"]);
  expect(toggleKind(["roll", "chat"], "roll")).toEqual(["chat"]);
});

describe("fetchAllLog", () => {
  it("쪽을 넘기며 오래된 순으로 모은다", async () => {
    const pages = [
      { entries: [e(3), e(4)], total: 4, hasMore: true, audience: "gm" as const },
      { entries: [e(1), e(2)], total: 4, hasMore: false, audience: "gm" as const },
    ];
    const seen: Array<number | undefined> = [];
    let i = 0;
    const r = await fetchAllLog(async (q) => (seen.push(q.before), pages[i++]!));
    expect(r.entries.map((x) => x.n)).toEqual([1, 2, 3, 4]);
    expect(r.complete).toBe(true);
    expect(seen).toEqual([undefined, 3]);
  });
  it("쪽 수 제한에 걸리면 complete=false", async () => {
    const r = await fetchAllLog(async () => ({ entries: [e(5)], total: 9, hasMore: true, audience: "public" }), {}, 2);
    expect(r.complete).toBe(false);
  });
});

describe("buildExport", () => {
  it("파일 이름과 내용", () => {
    const now = new Date(2026, 9, 18, 22, 0);
    const md = buildExport("md", [e(1)], { title: "밤의 탁자", audience: "public", now });
    expect(md.filename).toBe("session-log-public-20261018.md");
    expect(md.text).toContain("# 밤의 탁자");
    const js = buildExport("json", [e(1)], { title: "밤의 탁자", audience: "gm", now });
    expect(js.filename).toBe("session-log-gm-20261018.json");
    expect(JSON.parse(js.text).count).toBe(1);
  });
});
