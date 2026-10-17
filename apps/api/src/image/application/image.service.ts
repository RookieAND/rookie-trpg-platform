import { randomBytes } from "node:crypto";
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, isAudioMime, sniffAudio, sniffImage, type ImageStorage, type StoredImage } from "../domain/image-storage";

export type UploadResult = { ok: true; id: string } | { ok: false; code: "too_large" | "bad_type" | "rate_limited" | "empty" };

export interface ImageServiceOptions {
  now?: () => number;
  /** 한 사람이 windowMs 동안 올릴 수 있는 장수 */
  maxUploads?: number;
  windowMs?: number;
}

export class ImageService {
  private readonly recent = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly maxUploads: number;
  private readonly windowMs: number;

  constructor(
    private readonly storage: ImageStorage,
    opts: ImageServiceOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.maxUploads = opts.maxUploads ?? 30;
    this.windowMs = opts.windowMs ?? 60 * 60 * 1000;
  }

  upload(userId: string, bytes: Buffer): Promise<UploadResult> {
    return this.store(userId, bytes, "image");
  }

  /** 배경음과 효과음 파일. 이미지보다 크게 받고, 제한은 따로 센다. */
  uploadAudio(userId: string, bytes: Buffer): Promise<UploadResult> {
    return this.store(userId, bytes, "audio");
  }

  private async store(userId: string, bytes: Buffer, kind: "image" | "audio"): Promise<UploadResult> {
    if (bytes.length === 0) return { ok: false, code: "empty" };
    if (bytes.length > (kind === "audio" ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES)) return { ok: false, code: "too_large" };
    const mime = kind === "audio" ? sniffAudio(bytes) : sniffImage(bytes);
    if (!mime) return { ok: false, code: "bad_type" };
    const key = `${kind}:${userId}`;
    const t = this.now();
    const hits = (this.recent.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (hits.length >= this.maxUploads) return { ok: false, code: "rate_limited" };
    hits.push(t);
    this.recent.set(key, hits);
    const id = randomBytes(16).toString("hex");
    await this.storage.put(id, { bytes, mime });
    return { ok: true, id };
  }

  /** kind가 맞는 파일만 돌려준다(이미지 주소로 오디오를 꺼내지 못하게). */
  async get(id: string, kind: "image" | "audio" = "image"): Promise<StoredImage | null> {
    const found = await this.storage.get(id);
    return found && isAudioMime(found.mime) === (kind === "audio") ? found : null;
  }
}
