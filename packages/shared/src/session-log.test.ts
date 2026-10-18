import { describe, expect, it } from "vitest";
import type { LogEntry } from "./protocol";
import { canSeeLog, formatSessionLog, queryLog, sessionLogJson } from "./session-log";

const T = 1_760_000_000_000;
const e = (n: number, over: Partial<LogEntry> = {}): LogEntry => ({ n, at: T + n * 60_000, session: 1, kind: "scene", type: "x", text: `기록 ${n}`, audience: "all", scene: "장면 1", ...over });
const entries: LogEntry[] = [
  e(1, { kind: "session", type: "start", text: "세션 1 시작" }),
  e(2, { kind: "beat", text: "비트 이동: 비밀", audience: "gm" }),
  e(3, { kind: "handout", text: "핸드아웃 공개: 「편지」 → 서하", plText: "핸드아웃 공개: 「편지」", audience: ["pl1"] }),
  e(4, { kind: "roll", text: "서하 1d100 → 12", roll: { at: T + 240_000, who: "서하 · 도서관 사용", expr: "CC<=60", result: "12 → 어려운 성공", tags: [] } }),
  e(5, { kind: "chat", text: "서하: 안녕|하세요", chat: { name: "서하", text: "안녕|하세요\n둘째 줄" } }),
  e(6, { kind: "scene", text: "장면 전환: 지하실", scene: "지하실" }),
  e(7, { kind: "combat", text: "라운드 1 · 교단원 차례", plText: "라운드 1 · 알 수 없는 상대 차례", scene: "지하실" }),
  e(8, { kind: "session", type: "end", text: "세션 1 종료", session: 1, scene: "지하실" }),
  e(9, { kind: "session", type: "start", text: "세션 2 시작", session: 2, scene: "지하실" }),
];
const gm = { userId: "kp1", role: "kp" };
const pl1 = { userId: "pl1", role: "pl" };
const pl2 = { userId: "pl2", role: "pl" };

describe("canSeeLog / queryLog", () => {
  it("GM은 모두, 참가자는 공개된 것과 자기 몫만 본다", () => {
    expect(entries.filter((x) => canSeeLog(x, gm))).toHaveLength(9);
    expect(queryLog(entries, pl1).entries.map((x) => x.n)).toEqual([1, 3, 4, 5, 6, 7, 8, 9]);
    expect(queryLog(entries, pl2).entries.map((x) => x.n)).toEqual([1, 4, 5, 6, 7, 8, 9]);
    expect(queryLog(entries, { userId: "", role: "pl" }).entries.map((x) => x.n)).toEqual([1, 4, 5, 6, 7, 8, 9]);
  });
  it("참가자에게는 가린 글을 주고 사용자 id·공개 대상은 내보내지 않는다", () => {
    const pl = queryLog(entries, pl1);
    expect(pl.entries.find((x) => x.n === 7)!.text).toBe("라운드 1 · 알 수 없는 상대 차례");
    expect(pl.entries.find((x) => x.n === 3)!.text).toBe("핸드아웃 공개: 「편지」");
    expect(JSON.stringify(pl)).not.toContain("pl1");
    expect(JSON.stringify(pl)).not.toContain("audience");
    expect(JSON.stringify(pl)).not.toContain("plText");
    const g = queryLog(entries, gm);
    expect(g.entries.find((x) => x.n === 7)!.text).toBe("라운드 1 · 교단원 차례");
    expect(g.entries.find((x) => x.n === 2)!.scope).toBe("gm");
    expect(g.entries.find((x) => x.n === 3)!.scope).toBe("some");
    expect(g.entries.find((x) => x.n === 1)!.scope).toBeUndefined();
  });
  it("종류·세션·시간·쪽 나누기", () => {
    expect(queryLog(entries, gm, { kinds: ["session"] }).entries.map((x) => x.n)).toEqual([1, 8, 9]);
    expect(queryLog(entries, gm, { session: 2 }).entries.map((x) => x.n)).toEqual([9]);
    expect(queryLog(entries, gm, { since: T + 3 * 60_000, until: T + 5 * 60_000 }).entries.map((x) => x.n)).toEqual([3, 4, 5]);
    const p = queryLog(entries, gm, { limit: 3 });
    expect(p.entries.map((x) => x.n)).toEqual([7, 8, 9]);
    expect(p).toMatchObject({ total: 9, hasMore: true });
    expect(queryLog(entries, gm, { limit: 3, before: 7 }).entries.map((x) => x.n)).toEqual([4, 5, 6]);
    expect(queryLog(entries, gm, { limit: 100, before: 4 }).hasMore).toBe(false);
  });
});

describe("formatSessionLog", () => {
  const opts = { title: "밤의 도서관", exportedAt: T + 3_600_000, timeZone: "Asia/Seoul" } as const;
  it("날짜·장면 구획, 굴림 표, 대화 발췌가 있는 보고서 모양이다", () => {
    const md = formatSessionLog(queryLog(entries, gm).entries, { ...opts, audience: "gm" });
    expect(md.startsWith("# 밤의 도서관\n")).toBe(true);
    expect(md).toContain("> GM용 기록이에요.");
    expect(md).toMatch(/## 세션 1 · 2025-10-09/);
    expect(md).toMatch(/### 장면 1\n\n- \d\d:\d\d 세션 1 시작\n- \d\d:\d\d 비트 이동: 비밀 \(GM 전용\)\n- \d\d:\d\d 핸드아웃 공개: 「편지」 → 서하 \(GM 전용\)/);
    expect(md).toContain("### 지하실");
    expect(md).toContain("| 시각 | 누가 | 식 | 결과 |\n| --- | --- | --- | --- |\n| ");
    expect(md).toContain("| 서하 · 도서관 사용 | `CC<=60` | 12 → 어려운 성공 |");
    expect(md).toContain("**대화 발췌**");
    expect(md).toContain("**서하** 안녕|하세요 / 둘째 줄");
    expect(md).toContain("## 세션 2 · ");
    expect(md.endsWith("\n")).toBe(true);
    expect(md).not.toMatch(/\n{3,}/);
  });
  it("참가자용에는 GM 전용 줄이 없다", () => {
    const md = formatSessionLog(queryLog(entries, pl2).entries, { ...opts, audience: "public" });
    expect(md).toContain("> 참가자에게 보이는 내용만 담았어요.");
    expect(md).not.toContain("비밀");
    expect(md).not.toContain("GM 전용");
    expect(md).not.toContain("교단원");
    expect(md).toContain("알 수 없는 상대");
  });
  it("표 칸의 세로줄은 이스케이프한다", () => {
    const md = formatSessionLog(queryLog([e(1, { kind: "roll", text: "x", roll: { at: T, who: "가|나", expr: "1d6", result: "3", tags: ["푸시"] } })], gm).entries, { ...opts, audience: "gm" });
    expect(md).toContain("| 가\\|나 | `1d6` | 3 (푸시) |");
  });
  it("기록이 없으면 안내만", () => {
    expect(formatSessionLog([], { ...opts, audience: "public" })).toContain("기록이 없어요.");
  });
  it("JSON 내보내기는 형식 표시와 기록을 담는다", () => {
    const j = JSON.parse(sessionLogJson(queryLog(entries, pl1).entries, { ...opts, audience: "public" }));
    expect(j).toMatchObject({ format: "coc-vtt-session-log", version: 1, audience: "public", count: 8 });
    expect(j.entries).toHaveLength(8);
  });
});
