import { emptyLibrary, librarySchema, type Library } from "@coc-vtt/shared";
import type { LibraryRepository } from "../domain/user-library";

export class LibraryService {
  constructor(private readonly store: LibraryRepository) {}

  async get(userId: string): Promise<Library> {
    return (await this.store.load(userId)) ?? emptyLibrary();
  }

  /** 서재를 통째로 바꾼다. 규칙에 맞지 않으면 이유를 돌려준다. */
  async replace(userId: string, body: unknown): Promise<{ ok: true; library: Library } | { ok: false; message: string }> {
    const parsed = librarySchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { ok: false, message: first?.message && first.message !== "Required" ? first.message : "서재 정보가 올바르지 않아요." };
    }
    await this.store.save(userId, parsed.data);
    return { ok: true, library: parsed.data };
  }
}
