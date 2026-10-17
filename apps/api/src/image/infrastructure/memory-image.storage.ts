import type { ImageStorage, StoredImage } from "../domain/image-storage";

export class MemoryImageStorage implements ImageStorage {
  private readonly files = new Map<string, StoredImage>();
  async put(id: string, image: StoredImage) {
    this.files.set(id, image);
  }
  async get(id: string) {
    return this.files.get(id) ?? null;
  }
}
