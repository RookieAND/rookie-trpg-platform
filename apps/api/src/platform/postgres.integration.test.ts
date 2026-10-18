import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Room } from "@coc-vtt/room-core";
import type { VaultCharacter } from "../character/domain/vault-character";
import { PostgresVaultRepository } from "../character/infrastructure/postgres-vault.repository";
import { PostgresLibraryRepository } from "../library/infrastructure/postgres-library.repository";
import { PostgresImageStorage } from "../image/infrastructure/postgres-image.storage";
import type { StoredRoom } from "../room/domain/room.repository";
import { PostgresRoomRepository } from "../room/infrastructure/postgres-room.repository";
import { connectPostgres, migrate, type ClosableDb } from "./postgres";

// 실제 Postgres가 있을 때만 돈다: TEST_DATABASE_URL=postgres://... pnpm test
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Postgres 어댑터", () => {
  let db: ClosableDb;
  beforeAll(async () => {
    db = connectPostgres(url!);
    await migrate(db);
    await migrate(db); // 여러 번 불러도 안전해야 한다
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.query("truncate rooms, vaults, libraries, images");
  });

  const stored = (id: string, owner: string, members: string[]): StoredRoom => {
    const room = new Room(id, { newId: () => "x", rng: () => 0.5 });
    for (const m of members) room.join({ userId: m, name: m, role: "pl" });
    return {
      meta: { id, name: `룸 ${id}`, ownerId: owner, createdAt: 1, invite: { code: "abc", expiresAt: null, maxMembers: 6 }, discord: { webhookUrl: "https://discord.com/api/webhooks/1/x" } as never },
      data: room.toData(),
    };
  };

  it("룸을 저장하고 같은 내용으로 읽는다. 다시 저장하면 덮어쓴다", async () => {
    const repo = new PostgresRoomRepository(db);
    expect(await repo.load("r1")).toBeNull();
    const a = stored("r1", "kp", ["kp", "pl1"]);
    await repo.save(a);
    expect(await repo.load("r1")).toEqual(JSON.parse(JSON.stringify(a)));
    await repo.save({ ...a, meta: { ...a.meta, name: "바뀐 이름" } });
    expect((await repo.load("r1"))!.meta.name).toBe("바뀐 이름");
    expect((await db.query("select count(*)::int as n from rooms")).rows[0]).toEqual({ n: 1 });
  });

  it("대화·귓속말·세션 기록·설정과 schemaVersion을 잃지 않고 읽는다(jsonb 왕복)", async () => {
    const repo = new PostgresRoomRepository(db);
    let t = 1_700_000_000_000;
    const room = new Room("r-chat", { newId: () => "x", rng: () => 0.5, now: () => (t += 1000) });
    room.join({ userId: "kp", name: "하늘", role: "kp" });
    room.join({ userId: "pl1", name: "서하", role: "pl" });
    room.handle({ userId: "kp", name: "하늘", role: "kp" }, { type: "session.start", data: {} });
    room.handle({ userId: "kp", name: "하늘", role: "kp" }, { type: "settings.chat", data: { plWhisper: true } });
    room.handle({ userId: "pl1", name: "서하", role: "pl" }, { type: "chat.send", data: { text: "한글 \"따옴표\" 와 이모지 🎲" } });
    t += 2000;
    room.handle({ userId: "kp", name: "하늘", role: "kp" }, { type: "chat.send", data: { text: "귓속말이에요", to: "pl1" } });
    const a: StoredRoom = { meta: { id: "r-chat", name: "룸", ownerId: "kp", createdAt: 1, invite: { code: "abc", expiresAt: null, maxMembers: 6 } }, data: room.toData() };
    await repo.save(a);
    const back = (await repo.load("r-chat"))!;
    expect(back).toEqual(JSON.parse(JSON.stringify(a)));
    expect(back.data?.schemaVersion).toBe(2);
    expect(back.data?.chat?.map((m) => m.kind)).toEqual(["say", "whisper"]);
    expect(back.data?.chatSettings).toEqual({ plWhisper: true });
    expect(back.data?.log?.length).toBeGreaterThan(0);
    // 저장본으로 룸을 다시 열면 같은 대화가 보인다
    expect(Room.fromData(back.data!).chatHistory({ userId: "pl1", role: "pl" })).toHaveLength(2);
  });

  it("데이터가 아직 없는 룸(메타만)도 저장한다", async () => {
    const repo = new PostgresRoomRepository(db);
    const a = stored("r2", "kp", []);
    await repo.save({ meta: a.meta, data: null });
    expect(await repo.load("r2")).toEqual({ meta: JSON.parse(JSON.stringify(a.meta)), data: null });
  });

  it("내가 만들었거나 참가한 룸만 찾는다", async () => {
    const repo = new PostgresRoomRepository(db);
    await repo.save(stored("a", "kp", ["kp", "pl1"]));
    await repo.save(stored("b", "kp2", ["kp2", "pl1", "pl2"]));
    await repo.save(stored("c", "kp3", ["kp3"]));
    expect((await repo.listFor("pl1")).map((r) => r.meta.id).sort()).toEqual(["a", "b"]);
    expect((await repo.listFor("kp3")).map((r) => r.meta.id)).toEqual(["c"]);
    expect(await repo.listFor("nobody")).toEqual([]);
    // SQL 주입처럼 보이는 id도 값으로만 다룬다
    expect(await repo.listFor("x'; drop table rooms; --")).toEqual([]);
    expect((await db.query("select count(*)::int as n from rooms")).rows[0]).toEqual({ n: 3 });
  });

  it("보관함을 사용자별로 저장하고 읽는다", async () => {
    const repo = new PostgresVaultRepository(db);
    expect(await repo.load("u1")).toEqual([]);
    const list = [{ id: "c1", name: "윤서하", updatedAt: 5 }] as unknown as VaultCharacter[];
    await repo.save("u1", list);
    await repo.save("u2", []);
    expect(await repo.load("u1")).toEqual(list);
    await repo.save("u1", []);
    expect(await repo.load("u1")).toEqual([]);
  });

  it("서재(매크로·직업 정의)를 사용자별로 저장하고 읽는다", async () => {
    const repo = new PostgresLibraryRepository(db);
    expect(await repo.load("u1")).toBeNull();
    const lib = { macros: [{ id: "m1", name: "한 방", expr: "1d6", secret: false }], occupations: [] };
    expect(await repo.save("u1", lib, 0)).toBe(1);
    expect(await repo.save("u2", { macros: [], occupations: [] }, 0)).toBe(1);
    expect(await repo.load("u1")).toEqual({ library: lib, revision: 1 });
    expect(await repo.save("u1", { macros: [], occupations: [] }, 0)).toBeNull(); // 낡은 번호
    expect(await repo.save("u1", { macros: [], occupations: [] }, 1)).toBe(2);
    expect(await repo.load("u1")).toEqual({ library: { macros: [], occupations: [] }, revision: 2 });
  });

  it("이미지를 바이트 그대로 저장하고 읽는다", async () => {
    const storage = new PostgresImageStorage(db);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255, 128]);
    const id = "a".repeat(32);
    await storage.put(id, { bytes, mime: "image/png" });
    await storage.put(id, { bytes: Buffer.from("other"), mime: "image/gif" }); // 같은 id는 덮지 않는다
    const got = await storage.get(id);
    expect(got?.mime).toBe("image/png");
    expect(got?.bytes.equals(bytes)).toBe(true);
    expect(await storage.get("b".repeat(32))).toBeNull();
    expect(await storage.get("../etc")).toBeNull();
    await expect(storage.put("bad id", { bytes, mime: "image/png" })).rejects.toThrow();
  });
});
