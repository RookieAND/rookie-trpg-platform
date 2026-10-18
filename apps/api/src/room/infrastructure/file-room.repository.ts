import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RoomRepository, StoredRoom } from "../domain/room.repository";
import { involvesUser } from "../domain/room.repository";

/** 룸마다 JSON 파일 하나. 쓰는 도중 끊겨도 깨지지 않게 임시 파일에 쓴 뒤 바꿔치기한다. */
export class FileRoomRepository implements RoomRepository {
  constructor(private readonly dir: string) {}

  private path(id: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("invalid room id");
    return join(this.dir, `${id}.json`);
  }

  async load(id: string) {
    try {
      return JSON.parse(await readFile(this.path(id), "utf8")) as StoredRoom;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async save(room: StoredRoom) {
    await mkdir(this.dir, { recursive: true });
    const target = this.path(room.meta.id);
    const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(room), "utf8");
    await rename(tmp, target);
  }

  async remove(id: string) {
    await rm(this.path(id), { force: true });
  }

  async listFor(userId: string) {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const out: StoredRoom[] = [];
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const stored = await this.load(n.slice(0, -5));
      if (stored && involvesUser(stored, userId)) out.push(stored);
    }
    return out;
  }

  async *listAll() {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      const stored = await this.load(n.slice(0, -5));
      if (stored) yield stored;
    }
  }
}
