import type { ImageStorage, StoredImage, StoredImageInfo } from "../domain/image-storage";

export class MemoryImageStorage implements ImageStorage {
  private readonly files = new Map<string, StoredImage & { createdAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  /** 저장된 파일 수(시험용) */
  get size() {
    return this.files.size;
  }
  async put(id: string, image: StoredImage) {
    this.files.set(id, { ...image, createdAt: this.now() });
  }
  async remove(id: string) {
    this.files.delete(id);
  }
  async get(id: string) {
    const f = this.files.get(id);
    return f ? { bytes: f.bytes, mime: f.mime } : null;
  }
  async *list(): AsyncGenerator<StoredImageInfo> {
    for (const [id, f] of [...this.files]) yield { id, createdAt: f.createdAt };
  }
}
