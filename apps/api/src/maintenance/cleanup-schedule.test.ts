import { describe, expect, it } from "vitest";
import { MemoryImageStorage } from "../image/infrastructure/memory-image.storage";
import { MemoryRoomRepository } from "../room/infrastructure/memory-room.repository";
import type { StoredRoom } from "../room/domain/room.repository";
import { startCleanupSchedule } from "./cleanup-schedule";

const id = (n: number) => n.toString(16).padStart(32, "0");
const PNG = { bytes: Buffer.from([1]), mime: "image/png" as const };
const room: StoredRoom = {
  meta: { id: "r", name: "룸", ownerId: "o", createdAt: 0, invite: { code: "c", expiresAt: null, maxMembers: 6 } },
  data: { members: [], scenes: [{ id: "s", background: id(1) }], tokens: [] } as never,
};

async function setup() {
  const images = new MemoryImageStorage(() => 0); // 아주 오래전에 올린 파일
  await images.put(id(1), PNG);
  await images.put(id(2), PNG);
  const store = new MemoryRoomRepository();
  await store.save(room);
  return { images, store };
}

describe("이미지 정리 일정", () => {
  it("off면 아무것도 하지 않는다", async () => {
    const { images, store } = await setup();
    const s = startCleanupSchedule({ store, images, mode: "off", intervalHours: 1, minAgeDays: 1, maxDelete: 10 });
    expect(await s.runNow()).toBeNull();
    s.stop();
  });
  it("dry-run은 목록만 만들고 지우지 않으며, on은 쓰이지 않는 파일만 지운다", async () => {
    const { images, store } = await setup();
    const dry = startCleanupSchedule({ store, images, mode: "dry-run", intervalHours: 1, minAgeDays: 1, maxDelete: 10 });
    const r1 = await dry.runNow();
    expect(r1?.unused).toHaveLength(1);
    expect(r1?.deleted).toBe(0);
    dry.stop();
    const on = startCleanupSchedule({ store, images, mode: "on", intervalHours: 1, minAgeDays: 1, maxDelete: 10 });
    const r2 = await on.runNow();
    expect(r2?.deleted).toBe(1);
    on.stop();
    expect(await images.get(id(1))).toBeTruthy();
    expect(await images.get(id(2))).toBeNull();
  });
});
