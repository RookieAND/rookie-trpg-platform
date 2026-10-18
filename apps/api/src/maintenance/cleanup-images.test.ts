import { describe, expect, it } from "vitest";
import { MemoryImageStorage } from "../image/infrastructure/memory-image.storage";
import { MemoryRoomRepository } from "../room/infrastructure/memory-room.repository";
import type { StoredRoom } from "../room/domain/room.repository";
import { cleanupUnusedImages } from "./cleanup-images";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);
const id = (n: number) => n.toString(16).padStart(32, "0");
const PNG = { bytes: Buffer.from([1]), mime: "image/png" as const };
const room = (rid: string, refs: string[]): StoredRoom =>
  ({
    meta: { id: rid, name: "룸", ownerId: "o", createdAt: 0, invite: { code: "c", expiresAt: null, maxMembers: 6 } },
    data: { members: [], scenes: [{ id: "s", background: refs[0] ?? null }], tokens: refs.slice(1).map((r) => ({ image: r })) } as never,
  }) satisfies StoredRoom;

/** 올린 시각을 마음대로 정하는 저장소 */
async function setup() {
  let clock = T0;
  const images = new MemoryImageStorage(() => clock);
  const store = new MemoryRoomRepository();
  const upload = async (n: number, ageDays: number) => {
    clock = T0 + 30 * DAY - ageDays * DAY;
    await images.put(id(n), PNG);
  };
  return { images, store, upload, now: () => T0 + 30 * DAY };
}

describe("쓰이지 않는 이미지 정리", () => {
  it("저장된 룸이 가리키지 않고 N일보다 오래된 파일만 지운다", async () => {
    const { images, store, upload, now } = await setup();
    await upload(1, 20); // 룸 A가 배경으로 씀
    await upload(2, 20); // 룸 B 토큰
    await upload(3, 20); // 아무도 안 씀, 오래됨 -> 삭제
    await upload(4, 2); // 아무도 안 씀, 최근 -> 유지
    await upload(5, 8); // 아무도 안 씀, 8일 -> 삭제
    await store.save(room("a", [id(1)]));
    await store.save(room("b", [id(0xffff), id(2)]));
    const r = await cleanupUnusedImages({ store, images, minAgeDays: 7, dryRun: false, now });
    expect(r).toMatchObject({ rooms: 2, scanned: 5, tooNew: 1, deleted: 2, failed: 0 });
    expect(r.unused.sort()).toEqual([id(3), id(5)]);
    expect(await images.get(id(1))).not.toBeNull();
    expect(await images.get(id(2))).not.toBeNull();
    expect(await images.get(id(4))).not.toBeNull();
    expect(await images.get(id(3))).toBeNull();
    expect(await images.get(id(5))).toBeNull();
  });

  it("dryRun은 목록만 주고 지우지 않는다", async () => {
    const { images, store, upload, now } = await setup();
    await upload(1, 30);
    await upload(2, 30);
    await store.save(room("a", [id(1)]));
    const r = await cleanupUnusedImages({ store, images, minAgeDays: 7, dryRun: true, now });
    expect(r.unused).toEqual([id(2)]);
    expect(r.deleted).toBe(0);
    expect(images.size).toBe(2);
  });

  it("룸이 하나도 없는데 파일이 있으면 아무것도 지우지 않는다", async () => {
    const { images, store, upload, now } = await setup();
    await upload(1, 30);
    const lines: string[] = [];
    const r = await cleanupUnusedImages({ store, images, minAgeDays: 7, dryRun: false, now, log: (l) => lines.push(l) });
    expect(r.aborted).toBe("no_rooms");
    expect(images.size).toBe(1);
    expect(lines[0]).toMatch(/룸이 하나도 없는데/);
  });

  it("maxDelete를 넘으면 멈춘다", async () => {
    const { images, store, upload, now } = await setup();
    await store.save(room("a", [id(1)]));
    for (let i = 1; i <= 5; i++) await upload(i, 30);
    const r = await cleanupUnusedImages({ store, images, minAgeDays: 7, dryRun: false, now, maxDelete: 3 });
    expect(r.aborted).toBe("too_many");
    expect(images.size).toBe(5);
  });

  it("하나를 지우지 못해도 나머지는 계속 지운다", async () => {
    const { images, store, upload, now } = await setup();
    await store.save(room("a", [id(1)]));
    for (let i = 1; i <= 4; i++) await upload(i, 30);
    const realRemove = images.remove.bind(images);
    images.remove = async (x: string) => {
      if (x === id(3)) throw new Error("boom");
      return realRemove(x);
    };
    const r = await cleanupUnusedImages({ store, images, minAgeDays: 7, dryRun: false, now, log: () => {} });
    expect(r).toMatchObject({ deleted: 2, failed: 1 });
    expect(await images.get(id(3))).not.toBeNull();
  });
});
