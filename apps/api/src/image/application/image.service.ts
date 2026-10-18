import { randomBytes } from "node:crypto";
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, isAudioMime, sniffAudio, sniffImage, type ImageStorage, type StoredImage } from "../domain/image-storage";

export const UPLOADS_PER_USER_PER_HOUR = 30;
/** 한 IP에서 계정을 여러 개 만들어 한도를 돌려 쓰는 것을 막는 전역 한도 */
export const UPLOADS_PER_IP_PER_HOUR = 60;

export type UploadResult = { ok: true; id: string } | { ok: false; code: "too_large" | "bad_type" | "rate_limited" | "empty" };

export interface ImageServiceOptions {
  now?: () => number;
  /** 한 사람이 windowMs 동안 올릴 수 있는 장수 */
  maxUploads?: number;
  windowMs?: number;
  /** 한 IP가 windowMs 동안 올릴 수 있는 장수(이미지·오디오 합산) */
  maxUploadsPerIp?: number;
}

export class ImageService {
  private readonly recent = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly maxUploads: number;
  private readonly windowMs: number;
  private readonly maxUploadsPerIp: number;

  constructor(
    private readonly storage: ImageStorage,
    opts: ImageServiceOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.maxUploads = opts.maxUploads ?? UPLOADS_PER_USER_PER_HOUR;
    this.maxUploadsPerIp = opts.maxUploadsPerIp ?? UPLOADS_PER_IP_PER_HOUR;
    this.windowMs = opts.windowMs ?? 60 * 60 * 1000;
  }

  upload(userId: string, bytes: Buffer, ip?: string): Promise<UploadResult> {
    return this.store(userId, bytes, "image", ip);
  }

  /** 배경음과 효과음 파일. 이미지보다 크게 받고, 제한은 따로 센다. */
  uploadAudio(userId: string, bytes: Buffer, ip?: string): Promise<UploadResult> {
    return this.store(userId, bytes, "audio", ip);
  }

  private async store(userId: string, bytes: Buffer, kind: "image" | "audio", ip?: string): Promise<UploadResult> {
    if (bytes.length === 0) return { ok: false, code: "empty" };
    if (bytes.length > (kind === "audio" ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES)) return { ok: false, code: "too_large" };
    const mime = kind === "audio" ? sniffAudio(bytes) : sniffImage(bytes);
    if (!mime) return { ok: false, code: "bad_type" };
    const key = `${kind}:${userId}`;
    const ipKey = ip ? `ip:${ip}` : null;
    const t = this.now();
    const recent = (k: string) => (this.recent.get(k) ?? []).filter((x) => t - x < this.windowMs);
    const hits = recent(key);
    const ipHits = ipKey ? recent(ipKey) : [];
    if (hits.length >= this.maxUploads || (ipKey && ipHits.length >= this.maxUploadsPerIp)) return { ok: false, code: "rate_limited" };
    hits.push(t);
    this.recent.set(key, hits);
    if (ipKey) {
      ipHits.push(t);
      this.recent.set(ipKey, ipHits);
    }
    this.prune(t);
    const id = randomBytes(16).toString("hex");
    await this.storage.put(id, { bytes, mime });
    return { ok: true, id };
  }

  /** 오래된 기록만 남은 키를 치워 맵이 끝없이 자라지 않게 한다. */
  private prune(t: number) {
    if (this.recent.size < 5000) return;
    for (const [k, v] of this.recent) if (v.every((x) => t - x >= this.windowMs)) this.recent.delete(k);
  }

  /** 형식과 크기만 확인한다(저장하지 않는다). */
  inspect(bytes: Buffer, kind: "image" | "audio"): "ok" | "empty" | "too_large" | "bad_type" {
    if (bytes.length === 0) return "empty";
    if (bytes.length > (kind === "audio" ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES)) return "too_large";
    return (kind === "audio" ? sniffAudio(bytes) : sniffImage(bytes)) ? "ok" : "bad_type";
  }

  /**
   * 서버 안에서 파일을 옮겨 담을 때 쓴다(시나리오 가져오기). 형식과 크기는 그대로 확인하지만,
   * 사람이 올리는 길이 아니라서 업로드 횟수 제한에는 걸리지 않는다. 가져오기 쪽에서 횟수를 따로 제한한다.
   */
  async storeChecked(bytes: Buffer, kind: "image" | "audio"): Promise<{ ok: true; id: string } | { ok: false; code: "empty" | "too_large" | "bad_type" }> {
    const verdict = this.inspect(bytes, kind);
    if (verdict !== "ok") return { ok: false, code: verdict };
    const mime = (kind === "audio" ? sniffAudio(bytes) : sniffImage(bytes))!;
    const id = randomBytes(16).toString("hex");
    await this.storage.put(id, { bytes, mime });
    return { ok: true, id };
  }

  /** 이 id의 파일이 (kind가 맞게) 있는지 */
  async exists(id: string, kind: "image" | "audio"): Promise<boolean> {
    return (await this.get(id, kind)) !== null;
  }

  /** 있는 파일을 새 id로 복사한다. 룸을 지워도 다른 룸이 쓰는 파일이 같이 지워지지 않게 한다. 없으면 null. */
  async copy(id: string, kind: "image" | "audio"): Promise<string | null> {
    const found = await this.get(id, kind);
    if (!found) return null;
    const copy = randomBytes(16).toString("hex");
    await this.storage.put(copy, { bytes: Buffer.from(found.bytes), mime: found.mime });
    return copy;
  }

  /** 룸을 지울 때 그 룸이 쓰던 파일을 치운다. 하나가 실패해도 나머지는 계속 지운다. */
  async removeMany(ids: Iterable<string>): Promise<number> {
    let removed = 0;
    for (const id of ids) {
      try {
        await this.storage.remove(id);
        removed += 1;
      } catch (e) {
        console.warn(`파일 ${id} 지우기 실패:`, e instanceof Error ? e.message : e);
      }
    }
    return removed;
  }

  /** kind가 맞는 파일만 돌려준다(이미지 주소로 오디오를 꺼내지 못하게). */
  async get(id: string, kind: "image" | "audio" = "image"): Promise<StoredImage | null> {
    const found = await this.storage.get(id);
    return found && isAudioMime(found.mime) === (kind === "audio") ? found : null;
  }
}
