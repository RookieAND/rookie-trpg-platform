import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IMAGE_ID, type ImageStorage, type MediaMime, type StoredImage } from "../domain/image-storage";

const EXT: Record<MediaMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m])) as Record<string, MediaMime>;

/** 폴더에 `<id>.<확장자>`로 저장한다. id는 서버가 만든 16진수만 받아 경로 조작을 막는다. */
export class FileImageStorage implements ImageStorage {
  constructor(private readonly dir: string) {}

  async put(id: string, image: StoredImage) {
    if (!IMAGE_ID.test(id)) throw new Error("bad image id");
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${id}.${EXT[image.mime]}`), image.bytes);
  }

  async remove(id: string) {
    if (!IMAGE_ID.test(id)) return;
    for (const ext of Object.keys(MIME_BY_EXT)) {
      try {
        await unlink(join(this.dir, `${id}.${ext}`));
      } catch {
        /* 그 확장자로는 없다 */
      }
    }
  }

  async get(id: string) {
    if (!IMAGE_ID.test(id)) return null;
    for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
      try {
        return { bytes: await readFile(join(this.dir, `${id}.${ext}`)), mime };
      } catch {
        /* 다음 확장자 */
      }
    }
    return null;
  }
}
