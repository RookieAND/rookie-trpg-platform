import type { Library } from "@coc-vtt/shared";
import type { Db } from "../../platform/postgres";
import type { LibraryRepository, StoredLibrary } from "../domain/user-library";

/** 사용자마다 행 하나에 서재 전체를 JSON으로 둔다(매크로 12개·직업 20개까지라 작다). revision으로 동시 저장을 가른다. */
export class PostgresLibraryRepository implements LibraryRepository {
  constructor(private readonly db: Db) {}

  async load(userId: string): Promise<StoredLibrary | null> {
    const { rows } = await this.db.query<{ data: Library; revision: number }>("select data, revision from libraries where user_id = $1", [userId]);
    return rows[0] ? { library: rows[0].data, revision: Number(rows[0].revision) } : null;
  }

  async save(userId: string, library: Library, expected: number) {
    const json = JSON.stringify(library);
    if (expected === 0) {
      const ins = await this.db.query<{ revision: number }>(
        `insert into libraries (user_id, data, revision, updated_at) values ($1, $2, 1, now())
         on conflict (user_id) do nothing returning revision`,
        [userId, json],
      );
      if (ins.rows[0]) return 1;
      // 번호 0으로 남아 있는 예전 행이면 갱신한다.
    }
    const upd = await this.db.query<{ revision: number }>(
      "update libraries set data = $2, revision = revision + 1, updated_at = now() where user_id = $1 and revision = $3 returning revision",
      [userId, json, expected],
    );
    return upd.rows[0] ? Number(upd.rows[0].revision) : null;
  }
}
