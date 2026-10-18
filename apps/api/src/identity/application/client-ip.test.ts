import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { ClientIpResolver } from "./client-ip";

const req = (xff: string | undefined, remote = "10.0.0.1") =>
  ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: remote } }) as unknown as IncomingMessage;

describe("ClientIpResolver", () => {
  it("프록시를 믿지 않으면 X-Forwarded-For를 무시한다", () => {
    expect(new ClientIpResolver(0).of(req("1.2.3.4"))).toBe("10.0.0.1");
  });
  it("프록시 1겹이면 가장 오른쪽 값을 쓴다(왼쪽 위조는 무시)", () => {
    expect(new ClientIpResolver(1).of(req("6.6.6.6, 1.2.3.4"))).toBe("1.2.3.4");
  });
  it("2겹이면 오른쪽에서 두 번째", () => {
    expect(new ClientIpResolver(2).of(req("6.6.6.6, 1.2.3.4, 10.9.9.9"))).toBe("1.2.3.4");
  });
  it("헤더가 없거나 모자라면 소켓 주소로 돌아간다", () => {
    expect(new ClientIpResolver(1).of(req(undefined))).toBe("10.0.0.1");
    expect(new ClientIpResolver(3).of(req("1.2.3.4"))).toBe("10.0.0.1");
  });
});
