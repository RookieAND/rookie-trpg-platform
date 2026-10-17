import type { Out } from "@coc-vtt/room-core";
import { formatNotification, type DiscordGateway } from "../domain/discord";
import type { RoomMeta } from "../domain/room.repository";

export interface NotifierOptions {
  /** 같은 룸에 연달아 보내는 간격. 디스코드 웹훅 제한(분당 30회 안팎)을 넘지 않게 한다. */
  minIntervalMs?: number;
  /** 한 룸에서 대기할 수 있는 메시지 수. 넘으면 새 메시지를 버린다. */
  maxQueue?: number;
  onError?: (roomId: string, error: unknown) => void;
}

interface Lane {
  queue: string[];
  running: boolean;
}

/**
 * 룸 이벤트를 디스코드로 전달한다. 게임 진행을 막지 않도록 기다리지 않고(fire-and-forget),
 * 룸마다 순서를 지켜 간격을 두고 보낸다. 실패해도 게임에는 영향이 없다.
 */
export class DiscordNotifier {
  private lanes = new Map<string, Lane>();
  private readonly minInterval: number;
  private readonly maxQueue: number;
  private readonly onError: (roomId: string, error: unknown) => void;

  constructor(
    private readonly gateway: DiscordGateway,
    opts: NotifierOptions = {},
  ) {
    this.minInterval = opts.minIntervalMs ?? 500;
    this.maxQueue = opts.maxQueue ?? 20;
    this.onError = opts.onError ?? ((id, e) => console.warn(`디스코드 알림 실패 (room ${id}):`, e instanceof Error ? e.message : e));
  }

  /** 룸이 만든 이벤트 중 보낼 것만 골라 대기열에 넣는다. */
  publish(meta: RoomMeta, outs: Out[]): void {
    const cfg = meta.discord;
    if (!cfg) return;
    for (const out of outs) {
      const text = formatNotification(out.event, { roomName: meta.name }, cfg.events);
      if (text) this.enqueue(meta.id, cfg.webhookUrl, text);
    }
  }

  /** 설정 확인용. 실패하면 오류를 그대로 던진다. */
  test(webhookUrl: string, roomName: string): Promise<void> {
    return this.gateway.send(webhookUrl, `✅ **${roomName.slice(0, 60)}** · 디스코드 알림이 연결됐어요.`);
  }

  private enqueue(roomId: string, url: string, text: string) {
    let lane = this.lanes.get(roomId);
    if (!lane) this.lanes.set(roomId, (lane = { queue: [], running: false }));
    if (lane.queue.length >= this.maxQueue) return;
    lane.queue.push(text);
    if (!lane.running) void this.drain(roomId, url, lane);
  }

  private async drain(roomId: string, url: string, lane: Lane) {
    lane.running = true;
    while (lane.queue.length) {
      const text = lane.queue.shift() as string;
      try {
        await this.gateway.send(url, text);
      } catch (e) {
        this.onError(roomId, e);
      }
      if (lane.queue.length) await new Promise((r) => setTimeout(r, this.minInterval));
    }
    lane.running = false;
    this.lanes.delete(roomId);
  }
}
