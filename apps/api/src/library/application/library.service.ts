import { emptyLibrary, librarySchema, type Library } from "@coc-vtt/shared";
import type { LibraryRepository } from "../domain/user-library";

export type LibraryWithRevision = Library & { revision: number };

export type ReplaceResult =
  | { ok: true; library: LibraryWithRevision }
  | { ok: false; reason: "invalid"; message: string }
  | { ok: false; reason: "conflict"; library: LibraryWithRevision };

export class LibraryService {
  /** 사용자마다 저장을 한 줄로 세운다(읽고-비교하고-쓰는 사이에 다른 저장이 끼어들지 않게). */
  private queues = new Map<string, Promise<unknown>>();

  constructor(private readonly store: LibraryRepository) {}

  async get(userId: string): Promise<LibraryWithRevision> {
    const s = await this.store.load(userId);
    return { ...(s?.library ?? emptyLibrary()), revision: s?.revision ?? 0 };
  }

  /**
   * 서재를 통째로 바꾼다. baseRevision은 클라이언트가 마지막으로 받은 번호다.
   * 그 사이 다른 기기가 저장했으면 덮어쓰지 않고 최신 서재를 돌려줘서 클라이언트가 합치게 한다.
   */
  replace(userId: string, body: unknown): Promise<ReplaceResult> {
    const run = (this.queues.get(userId) ?? Promise.resolve()).then(() => this.doReplace(userId, body));
    const tail = run.catch(() => undefined);
    this.queues.set(userId, tail);
    void tail.then(() => this.queues.get(userId) === tail && this.queues.delete(userId));
    return run;
  }

  private async doReplace(userId: string, body: unknown): Promise<ReplaceResult> {
    const base = (body as { baseRevision?: unknown } | null)?.baseRevision;
    if (typeof base !== "number" || !Number.isInteger(base) || base < 0) return { ok: false, reason: "invalid", message: "서재 정보가 올바르지 않아요." };
    const parsed = librarySchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { ok: false, reason: "invalid", message: first?.message && first.message !== "Required" ? first.message : "서재 정보가 올바르지 않아요." };
    }
    const revision = await this.store.save(userId, parsed.data, base);
    if (revision === null) return { ok: false, reason: "conflict", library: await this.get(userId) };
    return { ok: true, library: { ...parsed.data, revision } };
  }
}
