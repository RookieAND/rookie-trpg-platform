import type { Library } from "@coc-vtt/shared";
import type { LibraryRepository, StoredLibrary } from "../domain/user-library";

export class MemoryLibraryRepository implements LibraryRepository {
  private data = new Map<string, { raw: string; revision: number }>();
  async load(userId: string): Promise<StoredLibrary | null> {
    const d = this.data.get(userId);
    return d ? { library: JSON.parse(d.raw) as Library, revision: d.revision } : null;
  }
  async save(userId: string, library: Library, expected: number) {
    const current = this.data.get(userId)?.revision ?? 0;
    if (current !== expected) return null;
    this.data.set(userId, { raw: JSON.stringify(library), revision: current + 1 });
    return current + 1;
  }
}
