"use client";
import { useCallback } from "react";
import { useLibrary } from "@/entities/library";
import type { Caller } from "@/shared/api";
import { addMacro, removeMacro, type AddResult } from "./macros";

/** 내 굴림 매크로. 서버의 내 서재에 저장해 기기를 옮겨도 따라온다. */
export function useRollMacros(me: Caller) {
  const { library, ready, error, update } = useLibrary(me);
  const macros = library?.macros ?? [];

  const add = useCallback(
    (input: { name: string; expr: string; secret: boolean }): AddResult => {
      if (!library) return { ok: false, message: "서재를 불러오는 중이에요. 잠시 뒤에 다시 해 주세요." };
      const r = addMacro(library.macros, input, () => Math.random().toString(36).slice(2, 10));
      if (r.ok) update({ ...library, macros: r.macros });
      return r;
    },
    [library, update],
  );
  const remove = useCallback(
    (id: string) => {
      if (library) update({ ...library, macros: removeMacro(library.macros, id) });
    },
    [library, update],
  );
  return { macros, ready, error, add, remove };
}
