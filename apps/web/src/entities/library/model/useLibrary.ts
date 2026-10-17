"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseOccupations, parseMacros } from "./legacy";
import { emptyLibrary, mergeLibrary, type Library } from "@coc-vtt/shared";
import { ApiError, type Caller } from "@/shared/api";
import { getLibrary, putLibrary, type LibraryRevision } from "../api/library-api";

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

const plain = (l: Library): Library => ({ macros: l.macros, occupations: l.occupations });

/**
 * 내 서재(매크로·직업 정의)를 서버에서 불러오고 바뀔 때마다 저장한다.
 * 서버에서 불러오기 전에는 쓸 수 없어서(ready=false) 비어 있는 값으로 서버 내용을 덮어쓰는 일이 없다.
 * 다른 기기가 먼저 저장했으면(번호가 어긋나면) 항목 단위로 합쳐서 다시 저장하고, 합칠 수 없으면 최신 내용을 불러온다.
 * 창으로 돌아올 때 다른 기기에서 바뀐 내용을 가져온다.
 */
export function useLibrary(me: Caller) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meRef = useRef(me);
  meRef.current = me;
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const current = useRef<Library | null>(null);
  current.current = library;
  /** 서버가 마지막으로 확인해 준 번호와 내용 */
  const server = useRef<{ revision: number; library: Library }>({ revision: 0, library: emptyLibrary() });
  const pending = useRef(0);

  const adopt = (l: LibraryRevision) => {
    server.current = { revision: l.revision, library: plain(l) };
    setLibrary(plain(l));
  };

  useEffect(() => {
    let alive = true;
    setLibrary(null);
    (async () => {
      try {
        const fetched = await getLibrary(meRef.current);
        const legacy = readLegacy(me.userId);
        server.current = { revision: fetched.revision, library: plain(fetched) };
        const merged: Library = {
          macros: fetched.macros.length ? fetched.macros : legacy.library.macros,
          occupations: fetched.occupations.length ? fetched.occupations : legacy.library.occupations,
        };
        if (legacy.keys.length) {
          const r = await putLibrary(meRef.current, merged, fetched.revision);
          const saved = r.ok ? r.library : r.conflict;
          try {
            for (const k of legacy.keys) localStorage.removeItem(k);
          } catch {
            /* 남아 있어도 다음에 서버 값이 우선이라 괜찮다 */
          }
          if (alive) adopt(saved);
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

  /** 저장 중인 것이 없을 때, 창으로 돌아오면 다른 기기에서 바뀐 서재를 가져온다. */
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState === "hidden" || pending.current > 0 || !current.current) return;
      try {
        const latest = await getLibrary(meRef.current);
        if (pending.current === 0 && latest.revision !== server.current.revision) adopt(latest);
      } catch {
        /* 다음에 다시 본다 */
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  /** 서재를 바꾼다. 화면에는 바로 반영하고, 서버 저장에 실패하면 되돌린다. */
  const update = useCallback((next: Library) => {
    const before = current.current;
    setLibrary(next);
    setError(null);
    pending.current += 1;
    chain.current = chain.current
      .then(async () => {
        let toSave = next;
        for (let attempt = 0; ; attempt++) {
          const r = await putLibrary(meRef.current, toSave, server.current.revision);
          if (r.ok) {
            server.current = { revision: r.library.revision, library: plain(r.library) };
            if (toSave !== next && current.current === next) setLibrary(toSave); // 다른 기기의 변경이 합쳐졌다
            return;
          }
          const theirs = plain(r.conflict);
          const merged = attempt < 3 ? mergeLibrary(server.current.library, toSave, theirs) : null;
          server.current = { revision: r.conflict.revision, library: theirs };
          if (!merged) {
            setLibrary(theirs);
            setError("다른 기기에서 바뀐 내용과 합칠 수 없어서 최신 내용을 불러왔어요. 다시 시도해 주세요.");
            return;
          }
          toSave = merged;
        }
      })
      .catch((e) => {
        setLibrary(before);
        setError(e instanceof ApiError ? e.message : "서버에 저장하지 못했어요.");
      })
      .finally(() => {
        pending.current -= 1;
      });
  }, []);

  return { library, ready: library !== null, error, update };
}
