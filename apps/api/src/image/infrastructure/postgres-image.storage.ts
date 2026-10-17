import type { Db } from "../../platform/postgres";
import { IMAGE_ID, type ImageStorage, type MediaMime, type StoredImage } from "../domain/image-storage";

/** 이미지를 bytea로 둔다(파일당 3MB 이하). 트래픽이 커지면 같은 포트로 R2/S3 어댑터를 쓴다. */
export class PostgresImageStorage implements ImageStorage {
  constructor(private readonly db: Db) {}

  async put(id: string, image: StoredImage) {
    if (!IMAGE_ID.test(id)) throw new Error("bad image id");
    await this.db.query("insert into images (id, mime, bytes) values ($1, $2, $3) on conflict (id) do nothing", [id, image.mime, image.bytes]);
  }

  async get(id: string) {
    if (!IMAGE_ID.test(id)) return null;
    const { rows } = await this.db.query<{ mime: MediaMime; bytes: Buffer }>("select mime, bytes from images where id = $1", [id]);
    return rows[0] ? { mime: rows[0].mime, bytes: rows[0].bytes } : null;
  }
}
