import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VaultCharacter, VaultRepository } from "../domain/vault-character";

/** 사용자마다 파일 하나. 파일 이름은 사용자 id의 해시라서 한글 id도 안전하다. */
export class FileVaultRepository implements VaultRepository {
  constructor(private readonly dir: string) {}
  private path(userId: string) {
    return join(this.dir, `${createHash("sha256").update(userId).digest("hex").slice(0, 32)}.json`);
  }
  async load(userId: string) {
    try {
      return JSON.parse(await readFile(this.path(userId), "utf8")) as VaultCharacter[];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  async save(userId: string, characters: VaultCharacter[]) {
    await mkdir(this.dir, { recursive: true });
    const target = this.path(userId);
    const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(characters), "utf8");
    await rename(tmp, target);
  }
}
