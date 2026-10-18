"use client";
import { useEffect, useRef, useState } from "react";

/** 이미 본 것(seen)에 없는 id만 골라낸다. */
export const unseenIds = (seen: ReadonlySet<string>, ids: readonly string[]) => ids.filter((id) => !seen.has(id));

/**
 * 새로 도착한 항목 id 목록. 처음 받은 목록(ready 직후)은 "이미 본 것"으로 치고, 이후 새로 생긴 항목만 센다.
 * `viewing`이 true인 동안(그 탭을 보는 중)에는 도착하는 대로 본 것으로 친다. `enabled`가 false면 늘 비어 있다.
 */
export function useUnseen(ids: readonly string[], opts: { ready: boolean; viewing: boolean; enabled: boolean }): string[] {
  const seen = useRef<Set<string> | null>(null);
  const [unseen, setUnseen] = useState<string[]>([]);
  const key = ids.join("\u0000");
  useEffect(() => {
    if (!opts.ready || !opts.enabled) return;
    if (!seen.current) seen.current = new Set(ids);
    else if (opts.viewing) ids.forEach((id) => seen.current!.add(id));
    const next = unseenIds(seen.current, ids);
    setUnseen((prev) => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, opts.ready, opts.viewing, opts.enabled]);
  return unseen;
}
