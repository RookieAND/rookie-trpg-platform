import type { Library } from "@coc-vtt/shared";
import type { Db } from "../../platform/postgres";
import type { LibraryRepository } from "../domain/user-library";

/** 사용자마다 행 하나에 서재 전체를 JSON으로 둔다(매크로 12개·직업 20개까지라 작다). */
export class PostgresLibraryRepository implements LibraryRepository {
  constructor(private readonly db: Db) {}

  async load(userId: string) {
    const { rows } = await this.db.query<{ data: Library }>("select data from libraries where user_id = $1", [userId]);
    return rows[0]?.data ?? null;
  }

  async save(userId: string, library: Library) {
    await this.db.query(
      `insert into libraries (user_id, data, updated_at) values ($1, $2, now())
       on conflict (user_id) do update set data = excluded.data, updated_at = now()`,
      [userId, JSON.stringify(library)],
    );
  }
}
