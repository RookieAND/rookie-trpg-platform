import type { Library } from "@coc-vtt/shared";
import { ApiError, http, type Caller } from "@/shared/api";

/** 서버가 저장한 서재와, 몇 번째 저장인지 */
export type LibraryRevision = Library & { revision: number };

export const getLibrary = (me: Caller) => http<LibraryRevision>(me, "GET", "/library");

export type PutResult = { ok: true; library: LibraryRevision } | { ok: false; conflict: LibraryRevision };

/** baseRevision은 내가 마지막으로 받은 번호다. 그 사이 다른 기기가 저장했으면 conflict로 최신을 돌려준다. */
export async function putLibrary(me: Caller, library: Library, baseRevision: number): Promise<PutResult> {
  try {
    const saved = await http<LibraryRevision>(me, "PUT", "/library", { macros: library.macros, occupations: library.occupations, baseRevision });
    return { ok: true, library: saved };
  } catch (e) {
    const latest = e instanceof ApiError && e.status === 409 ? (e.body as { library?: LibraryRevision } | null)?.library : undefined;
    if (latest) return { ok: false, conflict: latest };
    throw e;
  }
}
