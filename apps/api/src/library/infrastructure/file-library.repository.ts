import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Library } from "@coc-vtt/shared";
import type { LibraryRepository, StoredLibrary } from "../domain/user-library";

/** 사용자마다 파일 하나. 파일 이름은 사용자 id의 해시다. */
export class FileLibraryRepository implements LibraryRepository {
  constructor(private readonly dir: string) {}
  private path(userId: string) {
    return join(this.dir, `${createHash("sha256").update(userId).digest("hex").slice(0, 32)}.json`);
  }
  async load(userId: string): Promise<StoredLibrary | null> {
    try {
      const data = JSON.parse(await readFile(this.path(userId), "utf8")) as Library | StoredLibrary;
      // 번호가 없던 예전 파일은 0번째로 본다.
      return "library" in data ? data : { library: data, revision: 0 };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  /** 서비스가 사용자마다 한 번에 하나씩만 저장하게 막아 주므로 읽고-비교하고-쓰는 사이에 끼어들 일이 없다. */
  async save(userId: string, library: Library, expected: number) {
    const current = (await this.load(userId))?.revision ?? 0;
    if (current !== expected) return null;
    await mkdir(this.dir, { recursive: true });
    const target = this.path(userId);
    const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify({ library, revision: current + 1 }), "utf8");
    await rename(tmp, target);
    return current + 1;
  }
}
