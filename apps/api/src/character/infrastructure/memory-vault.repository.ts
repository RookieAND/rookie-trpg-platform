import type { VaultCharacter, VaultRepository } from "../domain/vault-character";

export class MemoryVaultRepository implements VaultRepository {
  private data = new Map<string, string>();
  async load(userId: string) {
    const raw = this.data.get(userId);
    return raw ? (JSON.parse(raw) as VaultCharacter[]) : [];
  }
  async save(userId: string, characters: VaultCharacter[]) {
    this.data.set(userId, JSON.stringify(characters));
  }
}
