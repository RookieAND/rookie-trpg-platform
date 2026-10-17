import type { Db } from "../../platform/postgres";
import type { VaultCharacter, VaultRepository } from "../domain/vault-character";

/** 사용자마다 행 하나에 보관함 전체를 JSON으로 둔다(최대 30명이라 작다). */
export class PostgresVaultRepository implements VaultRepository {
  constructor(private readonly db: Db) {}

  async load(userId: string) {
    const { rows } = await this.db.query<{ characters: VaultCharacter[] }>("select characters from vaults where user_id = $1", [userId]);
    return rows[0]?.characters ?? [];
  }

  async save(userId: string, characters: VaultCharacter[]) {
    await this.db.query(
      `insert into vaults (user_id, characters, updated_at) values ($1, $2, now())
       on conflict (user_id) do update set characters = excluded.characters, updated_at = now()`,
      [userId, JSON.stringify(characters)],
    );
  }
}
