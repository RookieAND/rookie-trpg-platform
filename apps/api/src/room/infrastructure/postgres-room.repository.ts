import type { Db } from "../../platform/postgres";
import type { RoomRepository, StoredRoom } from "../domain/room.repository";

interface Row {
  meta: StoredRoom["meta"];
  data: StoredRoom["data"];
}

const toStored = (r: Row): StoredRoom => ({ meta: r.meta, data: r.data });

/** 룸 하나가 한 행. 참가자 목록을 따로 들고 있어 "내가 참가한 룸"을 인덱스로 찾는다. */
export class PostgresRoomRepository implements RoomRepository {
  constructor(private readonly db: Db) {}

  async load(id: string) {
    const { rows } = await this.db.query<Row>("select meta, data from rooms where id = $1", [id]);
    return rows[0] ? toStored(rows[0]) : null;
  }

  async save(room: StoredRoom) {
    const members = [...new Set(room.data?.members.map((m) => m.userId) ?? [])];
    await this.db.query(
      `insert into rooms (id, owner_id, member_ids, meta, data, updated_at) values ($1, $2, $3, $4, $5, now())
       on conflict (id) do update set owner_id = excluded.owner_id, member_ids = excluded.member_ids, meta = excluded.meta, data = excluded.data, updated_at = now()`,
      [room.meta.id, room.meta.ownerId, members, JSON.stringify(room.meta), room.data ? JSON.stringify(room.data) : null],
    );
  }

  async remove(id: string) {
    await this.db.query("delete from rooms where id = $1", [id]);
  }

  async listFor(userId: string) {
    const { rows } = await this.db.query<Row>("select meta, data from rooms where owner_id = $1 or member_ids @> array[$1]::text[] order by updated_at desc", [userId]);
    return rows.map(toStored);
  }

  async *listAll() {
    let after = "";
    for (;;) {
      const { rows } = await this.db.query<Row & { id: string }>("select id, meta, data from rooms where id > $1 order by id limit 50", [after]);
      if (rows.length === 0) return;
      for (const r of rows) yield toStored(r);
      after = rows[rows.length - 1]!.id;
    }
  }
}
