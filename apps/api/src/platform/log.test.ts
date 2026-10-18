import { describe, expect, it } from "vitest";
import { createLogger, errFields, redact } from "./log";

describe("로그", () => {
  it("비밀 값을 가린다", () => {
    const cases: Array<[string, RegExp]> = [
      ["POST https://discord.com/api/webhooks/123/abcDEF_-x failed", /^POST \[웹훅 주소\] failed$/],
      ["Authorization: Bearer abc.def.ghi", /Bearer \[가림\]/],
      ["GET /ws?room=a&token=SECRETVALUE&role=kp", /token=\[가림\]&role=kp/],
      ["connect postgres://postgres:hunter2@db.x.supabase.co:5432/postgres", /postgres:\[가림\]@db/],
      ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl end", /jwt \[토큰\] end/],
      ["key AKIAIOSFODNN7EXAMPLE used", /key \[액세스키\] used/],
      ["password=abc secret: xyz", /password=\[가림\] secret: \[가림\]/],
    ];
    for (const [input, expected] of cases) {
      const out = redact(input);
      expect(out).toMatch(expected);
      expect(out).not.toMatch(/hunter2|SECRETVALUE|IOSFODNN7|abc\.def|c2lnbmF0dXJl|xyz/);
    }
  });
  it("오류는 이름·메시지·스택을 가려서 싣는다", () => {
    const e = new Error("fail token=abc123");
    const f = errFields(e);
    expect(f.err.message).toBe("fail token=[가림]");
    expect(f.err.stack).not.toContain("abc123");
    expect(errFields("plain").err.name).toBe("NonError");
    expect(errFields({ weird: true }).err.message).toBeTruthy();
  });
  it("한 줄 JSON으로 내보내고 레벨 아래는 버린다", () => {
    const lines: string[] = [];
    const log = createLogger({ level: "warn", sink: (l) => lines.push(l), now: () => 0 });
    log.info("무시");
    log.warn("경고", { roomId: "r1" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ t: "1970-01-01T00:00:00.000Z", level: "warn", msg: "경고", roomId: "r1" });
  });
  it("sink가 던져도 호출한 쪽은 멀쩡하다", () => {
    const log = createLogger({
      sink: () => {
        throw new Error("disk full");
      },
    });
    expect(() => log.error("x")).not.toThrow();
  });
});
