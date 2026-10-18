import { AUDIO_MIMES, IMAGE_ID, IMAGE_MIMES, type ImageStorage, type MediaMime, type StoredImage, type StoredImageInfo } from "../domain/image-storage";
import { S3Client } from "../../platform/s3-client";

const MIMES = new Set<string>([...IMAGE_MIMES, ...AUDIO_MIMES]);

/**
 * S3 호환 저장소(Cloudflare R2, AWS S3, MinIO)에 파일을 둔다. 객체 키는 `<prefix>/<서버가 만든 무작위 id>`이고
 * 형식은 Content-Type에 적는다. 파일은 버킷 주소로 직접 내보내지 않고 API(`/images/:id`)가 읽어서 돌려준다.
 * 그래서 버킷은 비공개로 두면 되고, 접근 권한 규칙은 지금처럼 API가 쥔다.
 */
export class S3ImageStorage implements ImageStorage {
  private readonly prefix: string;

  constructor(
    private readonly s3: S3Client,
    prefix = "",
  ) {
    this.prefix = prefix ? `${prefix.replace(/^\/+|\/+$/g, "")}/` : "";
  }

  private key(id: string) {
    return `${this.prefix}${id}`;
  }

  async put(id: string, image: StoredImage) {
    if (!IMAGE_ID.test(id)) throw new Error("bad image id");
    await this.s3.put(this.key(id), image.bytes, image.mime);
  }

  async get(id: string) {
    if (!IMAGE_ID.test(id)) return null;
    const found = await this.s3.get(this.key(id));
    const mime = found?.contentType?.split(";")[0]?.trim().toLowerCase();
    // 형식을 알 수 없는 객체(다른 곳에서 올린 파일)는 서빙하지 않는다.
    return found && mime && MIMES.has(mime) ? { bytes: found.bytes, mime: mime as MediaMime } : null;
  }

  async remove(id: string) {
    if (!IMAGE_ID.test(id)) return;
    await this.s3.delete(this.key(id));
  }

  async *list(): AsyncGenerator<StoredImageInfo> {
    for await (const o of this.s3.list(this.prefix)) {
      const id = o.key.slice(this.prefix.length);
      if (IMAGE_ID.test(id)) yield { id, createdAt: o.lastModified };
    }
  }
}
