import { randomBytes } from "node:crypto";
import { errFields, log } from "../../platform/log";
import { checkDimensions } from "../domain/image-dimensions";
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, isAudioMime, sniffAudio, sniffImage, type ImageStorage, type StoredImage } from "../domain/image-storage";

export const UPLOADS_PER_USER_PER_HOUR = 30;
/** 한 사람이 한 시간에 저장할 수 있는 파일 크기 합(올리기와 시나리오·백업 가져오기를 함께 센다) */
export const UPLOAD_BYTES_PER_USER_PER_HOUR = 60 * 1024 * 1024;
/** 한 IP에서 계정을 여러 개 만들어 한도를 돌려 쓰는 것을 막는 전역 한도 */
export const UPLOADS_PER_IP_PER_HOUR = 60;

export type UploadResult = { ok: true; id: string } | { ok: false; code: "too_large" | "bad_type" | "bad_size" | "rate_limited" | "empty" };

/** 누가 저장하는지(한도를 세는 데 쓴다). 서버 안의 일(정리 등)이면 생략한다. */
export interface Uploader {
  userId: string;
  ip?: string;
}

export interface ImageServiceOptions {
  now?: () => number;
  /** 한 사람이 windowMs 동안 올릴 수 있는 장수 */
  maxUploads?: number;
  windowMs?: number;
  /** 한 IP가 windowMs 동안 올릴 수 있는 장수(이미지·오디오 합산) */
  maxUploadsPerIp?: number;
  /** 한 사람이 windowMs 동안 저장할 수 있는 바이트 합 */
  maxBytes?: number;
  /** 이미지 한 변·전체 픽셀 상한 */
  maxImageSide?: number;
  maxImagePixels?: number;
}

export class ImageService {
  private readonly recent = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly maxUploads: number;
  private readonly windowMs: number;
  private readonly maxUploadsPerIp: number;
  private readonly maxBytes: number;
  private readonly dims: { side?: number; pixels?: number };
  private readonly spent = new Map<string, Array<[number, number]>>();

  constructor(
    private readonly storage: ImageStorage,
    opts: ImageServiceOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.maxUploads = opts.maxUploads ?? UPLOADS_PER_USER_PER_HOUR;
    this.maxUploadsPerIp = opts.maxUploadsPerIp ?? UPLOADS_PER_IP_PER_HOUR;
    this.windowMs = opts.windowMs ?? 60 * 60 * 1000;
    this.maxBytes = opts.maxBytes ?? UPLOAD_BYTES_PER_USER_PER_HOUR;
    this.dims = { side: opts.maxImageSide, pixels: opts.maxImagePixels };
  }

  upload(userId: string, bytes: Buffer, ip?: string): Promise<UploadResult> {
    return this.store(userId, bytes, "image", ip);
  }

  /** 배경음과 효과음 파일. 이미지보다 크게 받고, 제한은 따로 센다. */
  uploadAudio(userId: string, bytes: Buffer, ip?: string): Promise<UploadResult> {
    return this.store(userId, bytes, "audio", ip);
  }

  private async store(userId: string, bytes: Buffer, kind: "image" | "audio", ip?: string): Promise<UploadResult> {
    const verdict = this.inspect(bytes, kind);
    if (verdict !== "ok") return { ok: false, code: verdict };
    if (!this.charge({ userId, ip }, kind, bytes.length)) return { ok: false, code: "rate_limited" };
    const mime = (kind === "audio" ? sniffAudio(bytes) : sniffImage(bytes))!;
    const id = randomBytes(16).toString("hex");
    await this.storage.put(id, { bytes, mime });
    return { ok: true, id };
  }

  /**
   * 한도를 한 번 쓴다(파일 수: 사용자·IP, 바이트: 사용자). 넘으면 false이고 아무것도 세지 않는다.
   * 올리기와 시나리오·백업 가져오기가 같은 통을 쓴다.
   */
  private charge(who: Uploader, kind: "image" | "audio", size: number): boolean {
    const key = `${kind}:${who.userId}`;
    const ipKey = who.ip ? `ip:${who.ip}` : null;
    const bytesKey = `bytes:${who.userId}`;
    const t = this.now();
    const recent = (k: string) => (this.recent.get(k) ?? []).filter((x) => t - x < this.windowMs);
    const hits = recent(key);
    const ipHits = ipKey ? recent(ipKey) : [];
    const used = (this.spent.get(bytesKey) ?? []).filter(([at]) => t - at < this.windowMs);
    const usedBytes = used.reduce((a, [, n]) => a + n, 0);
    if (hits.length >= this.maxUploads || (ipKey && ipHits.length >= this.maxUploadsPerIp) || usedBytes + size > this.maxBytes) return false;
    hits.push(t);
    this.recent.set(key, hits);
    if (ipKey) {
      ipHits.push(t);
      this.recent.set(ipKey, ipHits);
    }
    used.push([t, size]);
    this.spent.set(bytesKey, used);
    this.prune(t);
    return true;
  }

  /** 오래된 기록만 남은 키를 치워 맵이 끝없이 자라지 않게 한다. */
  private prune(t: number) {
    if (this.recent.size >= 5000) for (const [k, v] of this.recent) if (v.every((x) => t - x >= this.windowMs)) this.recent.delete(k);
    if (this.spent.size >= 5000) for (const [k, v] of this.spent) if (v.every(([x]) => t - x >= this.windowMs)) this.spent.delete(k);
  }

  /** 형식과 크기만 확인한다(저장하지 않는다). */
  inspect(bytes: Buffer, kind: "image" | "audio"): "ok" | "empty" | "too_large" | "bad_type" | "bad_size" {
    if (bytes.length === 0) return "empty";
    if (bytes.length > (kind === "audio" ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES)) return "too_large";
    if (kind === "audio") return sniffAudio(bytes) ? "ok" : "bad_type";
    const mime = sniffImage(bytes);
    if (!mime) return "bad_type";
    // 파일 머리의 가로·세로를 읽어 픽셀 폭탄(용량은 작은데 수억 화소)을 걸러낸다. 머리가 깨진 파일도 받지 않는다.
    const dim = checkDimensions(bytes, mime, this.dims);
    return dim === "ok" ? "ok" : dim === "too_big" ? "bad_size" : "bad_type";
  }

  /**
   * 서버 안에서 파일을 옮겨 담을 때 쓴다(시나리오 가져오기). 형식·크기·픽셀 수를 똑같이 확인하고,
   * 누가 저장하는지(who)를 주면 올리기와 같은 시간당 한도(장수·바이트)를 함께 쓴다.
   */
  async storeChecked(bytes: Buffer, kind: "image" | "audio", who?: Uploader): Promise<{ ok: true; id: string } | { ok: false; code: "empty" | "too_large" | "bad_type" | "bad_size" | "rate_limited" }> {
    const verdict = this.inspect(bytes, kind);
    if (verdict !== "ok") return { ok: false, code: verdict };
    if (who && !this.charge(who, kind, bytes.length)) return { ok: false, code: "rate_limited" };
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
  async copy(id: string, kind: "image" | "audio", who?: Uploader): Promise<string | null | "rate_limited"> {
    const found = await this.get(id, kind);
    if (!found) return null;
    if (who && !this.charge(who, kind, found.bytes.length)) return "rate_limited";
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
        log.warn("파일 지우기 실패", { imageId: id, ...errFields(e) });
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
