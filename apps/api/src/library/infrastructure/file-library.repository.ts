import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Library } from "@coc-vtt/shared";
import type { LibraryRepository } from "../domain/user-library";

/** 사용자마다 파일 하나. 파일 이름은 사용자 id의 해시다. */
export class FileLibraryRepository implements LibraryRepository {
  constructor(private readonly dir: string) {}
  private path(userId: string) {
    return join(this.dir, `${createHash("sha256").update(userId).digest("hex").slice(0, 32)}.json`);
  }
  async load(userId: string) {
    try {
      return JSON.parse(await readFile(this.path(userId), "utf8")) as Library;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async save(userId: string, library: Library) {
    await mkdir(this.dir, { recursive: true });
    const target = this.path(userId);
    const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(library), "utf8");
    await rename(tmp, target);
  }
}
