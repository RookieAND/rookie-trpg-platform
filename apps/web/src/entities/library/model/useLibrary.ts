"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseOccupations, parseMacros } from "./legacy";
import { emptyLibrary, type Library } from "@coc-vtt/shared";
import { ApiError, type Caller } from "@/shared/api";
import { getLibrary, putLibrary } from "../api/library-api";

const LEGACY = (userId: string) => ({ macros: `coc-vtt.macros.${userId}`, occupations: `coc-vtt.occupations.${userId}` });

/** 이 브라우저에만 있던 예전 저장값을 읽는다. 서버 서재가 비어 있을 때 한 번만 옮긴다. */
function readLegacy(userId: string): { library: Library; keys: string[] } {
  const keys = LEGACY(userId);
  const out = emptyLibrary();
  const used: string[] = [];
  try {
    const m = parseMacros(localStorage.getItem(keys.macros));
    if (m.length) (out.macros = m), used.push(keys.macros);
    const o = parseOccupations(localStorage.getItem(keys.occupations));
    if (o.length) (out.occupations = o), used.push(keys.occupations);
  } catch {
    /* 저장소를 못 쓰면 옮길 것이 없다 */
  }
  return { library: out, keys: used };
}

/**
 * 내 서재(매크로·직업 정의)를 서버에서 불러오고 바뀔 때마다 저장한다.
 * 서버에서 불러오기 전에는 쓸 수 없어서(ready=false) 비어 있는 값으로 서버 내용을 덮어쓰는 일이 없다.
 */
export function useLibrary(me: Caller) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meRef = useRef(me);
  meRef.current = me;
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const current = useRef<Library | null>(null);
  current.current = library;

  useEffect(() => {
    let alive = true;
    setLibrary(null);
    (async () => {
      try {
        const server = await getLibrary(meRef.current);
        const legacy = readLegacy(me.userId);
        const merged: Library = {
          macros: server.macros.length ? server.macros : legacy.library.macros,
          occupations: server.occupations.length ? server.occupations : legacy.library.occupations,
        };
        if (legacy.keys.length) {
          const saved = await putLibrary(meRef.current, merged);
          try {
            for (const k of legacy.keys) localStorage.removeItem(k);
          } catch {
            /* 남아 있어도 다음에 서버 값이 우선이라 괜찮다 */
          }
          if (alive) setLibrary(saved);
          return;
        }
        if (alive) setLibrary(merged);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : "서버에 연결하지 못했어요. 서재를 불러오지 못했어요.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [me.userId]);

  /** 서재를 바꾼다. 화면에는 바로 반영하고, 서버 저장에 실패하면 되돌린다. */
  const update = useCallback((next: Library) => {
    const before = current.current;
    setLibrary(next);
    setError(null);
    chain.current = chain.current.then(async () => {
      try {
        await putLibrary(meRef.current, next);
      } catch (e) {
        setLibrary(before);
        setError(e instanceof ApiError ? e.message : "서버에 저장하지 못했어요.");
      }
    });
  }, []);

  return { library, ready: library !== null, error, update };
}
