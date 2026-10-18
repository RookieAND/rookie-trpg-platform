import { describe, expect, it } from "vitest";
import { MessageRateLimiter } from "./rate-limit";

const opts = { burst: 5, perSec: 2, maxStrikes: 3, strikeWindowMs: 1000 };

describe("MessageRateLimiter", () => {
  it("버스트까지 받고 넘으면 거절한다", () => {
    let t = 0;
    const l = new MessageRateLimiter(opts, () => t);
    for (let i = 0; i < 5; i++) expect(l.take()).toBe("ok");
    expect(l.take()).toBe("reject");
  });
  it("시간이 지나면 채워진다", () => {
    let t = 0;
    const l = new MessageRateLimiter(opts, () => t);
    for (let i = 0; i < 5; i++) l.take();
    t = 1000; // 2개 채워짐
    expect(l.take()).toBe("ok");
    expect(l.take()).toBe("ok");
    expect(l.take()).toBe("reject");
  });
  it("거절이 계속 쌓이면 닫으라고 한다", () => {
    let t = 0;
    const l = new MessageRateLimiter(opts, () => t);
    for (let i = 0; i < 5; i++) l.take();
    expect([l.take(), l.take(), l.take()]).toEqual(["reject", "reject", "close"]);
  });
  it("창이 지나면 거절 횟수는 다시 센다", () => {
    let t = 0;
    const l = new MessageRateLimiter(opts, () => t);
    for (let i = 0; i < 5; i++) l.take();
    l.take();
    l.take();
    t = 2000;
    for (let i = 0; i < 5; i++) l.take(); // 다시 비움
    expect(l.take()).toBe("reject");
  });
});
