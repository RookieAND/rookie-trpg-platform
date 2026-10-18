/** 한 룸에서 다시 쓸 수 있는 이미지 id 목록을 다루는 순수 함수들. */
export const LIBRARY_MAX = 30;

/** id를 맨 앞으로 올리고(중복 제거) 최대 개수까지만 남긴다. */
export function rememberId(list: readonly string[], id: string, max = LIBRARY_MAX): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

/** 내가 방금 올린 것(recent)을 앞에, 룸에 이미 쓰인 것(derived)을 뒤에 두고 중복을 없앤다. */
export function mergeLibrary(recent: readonly string[], derived: readonly string[], max = LIBRARY_MAX): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...recent, ...derived]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** 장면 배경·오브젝트·핸드아웃에 쓰인 이미지 id. 나중에 만든 것이 앞에 오도록 뒤집어 돌려준다. */
export function roomImageIds(src: { scenes: ReadonlyArray<{ background?: string }>; objects: ReadonlyArray<{ image?: string }>; handouts: ReadonlyArray<{ image?: string }> }): string[] {
  const all = [...src.scenes.map((s) => s.background), ...src.objects.map((o) => o.image), ...src.handouts.map((h) => h.image)];
  return all.filter((x): x is string => Boolean(x)).reverse();
}

/** 브라우저 저장소에 룸별로 올린 이미지를 기억하는 키 */
export const libraryKey = (roomId: string) => `coc-vtt:images:${roomId}`;

export function readRecent(roomId: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(libraryKey(roomId)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, LIBRARY_MAX) : [];
  } catch {
    return [];
  }
}

export function writeRecent(roomId: string, ids: readonly string[]): void {
  try {
    localStorage.setItem(libraryKey(roomId), JSON.stringify(ids.slice(0, LIBRARY_MAX)));
  } catch {
    /* 저장소를 쓸 수 없어도 목록은 이번 접속 동안 유지된다 */
  }
}
