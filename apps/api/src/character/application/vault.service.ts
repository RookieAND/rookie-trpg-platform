import { randomBytes } from "node:crypto";
import type { CharacterData } from "@coc-vtt/shared";
import { MAX_VAULT_CHARACTERS, type VaultCharacter, type VaultRepository } from "../domain/vault-character";

/** 같은 사용자의 동시 수정이 서로 덮어쓰지 않도록 사용자별로 줄을 세운다. */
export class VaultService {
  private chains = new Map<string, Promise<unknown>>();
  constructor(
    private readonly store: VaultRepository,
    private readonly now: () => number = Date.now,
  ) {}

  private serial<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(userId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.chains.set(userId, run.catch(() => undefined));
    return run;
  }

  list(userId: string) {
    return this.serial(userId, () => this.store.load(userId));
  }

  create(userId: string, data: CharacterData) {
    return this.serial(userId, async () => {
      const all = await this.store.load(userId);
      if (all.length >= MAX_VAULT_CHARACTERS) return { ok: false as const, reason: "full" as const };
      const c: VaultCharacter = { ...data, id: randomBytes(8).toString("base64url"), updatedAt: this.now() };
      await this.store.save(userId, [...all, c]);
      return { ok: true as const, character: c };
    });
  }

  update(userId: string, id: string, data: CharacterData) {
    return this.serial(userId, async () => {
      const all = await this.store.load(userId);
      const i = all.findIndex((c) => c.id === id);
      if (i < 0) return { ok: false as const, reason: "not_found" as const };
      const c: VaultCharacter = { ...data, id, updatedAt: this.now() };
      all[i] = c;
      await this.store.save(userId, all);
      return { ok: true as const, character: c };
    });
  }

  remove(userId: string, id: string) {
    return this.serial(userId, async () => {
      const all = await this.store.load(userId);
      if (!all.some((c) => c.id === id)) return false;
      await this.store.save(userId, all.filter((c) => c.id !== id));
      return true;
    });
  }
}
