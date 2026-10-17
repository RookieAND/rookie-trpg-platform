import type { Library } from "@coc-vtt/shared";
import type { LibraryRepository } from "../domain/user-library";

export class MemoryLibraryRepository implements LibraryRepository {
  private data = new Map<string, string>();
  async load(userId: string) {
    const raw = this.data.get(userId);
    return raw ? (JSON.parse(raw) as Library) : null;
  }
  async save(userId: string, library: Library) {
    this.data.set(userId, JSON.stringify(library));
  }
}
