import { describe, expect, it } from "vitest";
import type { Out } from "@coc-vtt/room-core";
import { DiscordNotifier } from "./discord-notifier";
import type { RoomMeta } from "../domain/room.repository";

const meta = (discord = true) =>
  ({ id: "r", name: "룸", ownerId: "o", ...(discord ? { discord: { webhookUrl: "u", events: { session: true, rolls: true } } } : {}) }) as unknown as RoomMeta;
const ended = { event: { type: "session.ended", data: {} }, audience: {} } as unknown as Out;

describe("DiscordNotifier", () => {
  it("순서대로 보낸다", async () => {
    const sent: string[] = [];
    const n = new DiscordNotifier({ send: async (_u, t) => void sent.push(t) }, { minIntervalMs: 0 });
    n.publish(meta(), [ended, ended]);
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(2);
  });
  it("설정이 없으면 보내지 않는다", async () => {
    const sent: string[] = [];
    const n = new DiscordNotifier({ send: async (_u, t) => void sent.push(t) }, { minIntervalMs: 0 });
    n.publish(meta(false), [ended]);
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toHaveLength(0);
  });
  it("전송이 실패해도 던지지 않고 다음 것을 보낸다", async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const n = new DiscordNotifier(
      { send: async () => { if (calls++ === 0) throw new Error("x"); } },
      { minIntervalMs: 0, onError: (_i, e) => errors.push(e) },
    );
    n.publish(meta(), [ended, ended]);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);
  });
  it("대기열이 가득 차면 새 메시지를 버린다", async () => {
    const sent: string[] = [];
    const n = new DiscordNotifier({ send: async (_u, t) => void sent.push(t) }, { minIntervalMs: 0, maxQueue: 2 });
    n.publish(meta(), [ended, ended, ended, ended, ended]);
    await new Promise((r) => setTimeout(r, 30));
    expect(sent.length).toBeLessThan(5);
  });
});
