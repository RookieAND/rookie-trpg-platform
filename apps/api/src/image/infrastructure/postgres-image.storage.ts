import type { Db } from "../../platform/postgres";
import { IMAGE_ID, type ImageStorage, type MediaMime, type StoredImage, type StoredImageInfo } from "../domain/image-storage";

/** 이미지를 bytea로 둔다(파일당 3MB 이하). 트래픽이 커지면 같은 포트로 R2/S3 어댑터를 쓴다. */
export class PostgresImageStorage implements ImageStorage {
  constructor(private readonly db: Db) {}

  async put(id: string, image: StoredImage) {
    if (!IMAGE_ID.test(id)) throw new Error("bad image id");
    await this.db.query("insert into images (id, mime, bytes) values ($1, $2, $3) on conflict (id) do nothing", [id, image.mime, image.bytes]);
  }

  async remove(id: string) {
    if (!IMAGE_ID.test(id)) return;
    await this.db.query("delete from images where id = $1", [id]);
  }

  async get(id: string) {
    if (!IMAGE_ID.test(id)) return null;
    const { rows } = await this.db.query<{ mime: MediaMime; bytes: Buffer }>("select mime, bytes from images where id = $1", [id]);
    return rows[0] ? { mime: rows[0].mime, bytes: rows[0].bytes } : null;
  }

  async *list(): AsyncGenerator<StoredImageInfo> {
    // 바이트는 읽지 않고 id와 시각만 쪽 단위로 읽는다.
    let after = "";
    for (;;) {
      const { rows } = await this.db.query<{ id: string; t: string | number }>(
        "select id, (extract(epoch from created_at) * 1000)::float8 as t from images where id > $1 order by id limit 1000",
        [after],
      );
      if (rows.length === 0) return;
      for (const r of rows) yield { id: r.id, createdAt: Number(r.t) };
      after = rows[rows.length - 1]!.id;
    }
  }
}
