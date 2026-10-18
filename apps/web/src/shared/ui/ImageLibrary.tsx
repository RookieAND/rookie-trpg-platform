"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { mergeLibrary, readRecent, rememberId, writeRecent } from "./image-library";

export interface Library {
  /** 다시 쓸 수 있는 이미지 id. 최근 것이 앞에 온다. */
  ids: string[];
  /** 방금 올린 이미지를 목록 맨 앞에 올린다. */
  remember: (id: string) => void;
}

const Ctx = createContext<Library>({ ids: [], remember: () => {} });

/**
 * 룸 안의 이미지 고르기 목록. 내가 올린 것(이 브라우저에 기억)과 룸에 이미 쓰인 것을 합쳐 보여 준다.
 * 값은 룸 화면에서 만들어 ImageLibraryProvider로 내려 준다.
 */
export function useImageLibraryStore(roomId: string, used: readonly string[]): Library {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readRecent(roomId)), [roomId]);
  const remember = useCallback(
    (id: string) =>
      setRecent((l) => {
        const next = rememberId(l, id);
        writeRecent(roomId, next);
        return next;
      }),
    [roomId],
  );
  return useMemo(() => ({ ids: mergeLibrary(recent, used), remember }), [recent, used, remember]);
}

export function ImageLibraryProvider({ value, children }: { value: Library; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useImageLibrary = () => useContext(Ctx);
