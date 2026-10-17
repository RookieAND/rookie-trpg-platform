import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@coc-vtt/shared";
import { formatNotification, isValidWebhookUrl } from "./discord";

const ctx = { roomName: "안개 낀 저택" };
const all = { session: true, rolls: true };
const roll = (secret: boolean): ServerEvent =>
  ({
    type: "roll.result",
    data: { id: "r1", userId: "u", userName: "윤서하", expr: "1d100", label: "", secret, at: 0, outcome: { kind: "dice", rolls: [[33]], modifier: 0, total: 33 } },
  }) as unknown as ServerEvent;

describe("isValidWebhookUrl", () => {
  const ok = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-ABC";
  it("디스코드 웹훅만 허용한다", () => {
    expect(isValidWebhookUrl(ok)).toBe(true);
    expect(isValidWebhookUrl(ok.replace("https", "http"))).toBe(false);
    expect(isValidWebhookUrl("https://evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz")).toBe(false);
    expect(isValidWebhookUrl("https://discord.com.evil.io/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz")).toBe(false);
    expect(isValidWebhookUrl("http://127.0.0.1/")).toBe(false);
  });
});

describe("formatNotification", () => {
  it("공개 굴림은 보내고 비밀 굴림은 보내지 않는다", () => {
    expect(formatNotification(roll(false), ctx, all)).toContain("윤서하");
    expect(formatNotification(roll(true), ctx, all)).toBeNull();
  });
  it("꺼 둔 종류는 보내지 않는다", () => {
    expect(formatNotification(roll(false), ctx, { session: true, rolls: false })).toBeNull();
    expect(formatNotification({ type: "session.ended", data: {} } as unknown as ServerEvent, ctx, { session: false, rolls: true })).toBeNull();
  });
  it("멘션이나 백틱이 섞인 이름도 한 줄로 정리한다", () => {
    const text = formatNotification({ type: "session.ended", data: {} } as unknown as ServerEvent, { roomName: "a`\n@everyone" }, all);
    expect(text).not.toContain("\n");
    expect(text).not.toContain("`");
  });
  it("관련 없는 이벤트는 null", () => {
    expect(formatNotification({ type: "presence", data: { members: [] } } as unknown as ServerEvent, ctx, all)).toBeNull();
  });
});
