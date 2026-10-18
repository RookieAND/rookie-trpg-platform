"use client";
import { useCallback } from "react";
import type { Occupation } from "@coc-vtt/shared";
import { useLibrary } from "@/entities/library";
import type { Caller } from "@/shared/api";
import { addOccupation, exportOccupations, importOccupations, removeOccupation, updateOccupation, type AddOccupationResult, type ImportResult } from "./occupations";

/** 내가 정의한 직업. 서버의 내 서재에 저장해 기기를 옮겨도 따라온다. */
export function useOccupations(me: Caller) {
  const { library, ready, error, update } = useLibrary(me);
  const occupations = library?.occupations ?? [];

  const add = useCallback(
    (input: Omit<Occupation, "id">): AddOccupationResult => {
      if (!library) return { ok: false, message: "저장해 둔 목록을 불러오는 중이에요. 잠시 뒤에 다시 해 주세요." };
      const r = addOccupation(library.occupations, input, () => Math.random().toString(36).slice(2, 10));
      if (r.ok) update({ ...library, occupations: r.occupations });
      return r;
    },
    [library, update],
  );
  const remove = useCallback(
    (id: string) => {
      if (library) update({ ...library, occupations: removeOccupation(library.occupations, id) });
    },
    [library, update],
  );
  const edit = useCallback(
    (id: string, input: Omit<Occupation, "id">): AddOccupationResult => {
      if (!library) return { ok: false, message: "저장해 둔 목록을 불러오는 중이에요. 잠시 뒤에 다시 해 주세요." };
      const r = updateOccupation(library.occupations, id, input);
      if (r.ok) update({ ...library, occupations: r.occupations });
      return r;
    },
    [library, update],
  );
  const exportText = useCallback(() => exportOccupations(occupations), [occupations]);
  const importText = useCallback(
    (text: string): ImportResult => {
      if (!library) return { ok: false, message: "저장해 둔 목록을 불러오는 중이에요. 잠시 뒤에 다시 해 주세요." };
      const r = importOccupations(library.occupations, text, () => Math.random().toString(36).slice(2, 10));
      if (r.ok && r.added > 0) update({ ...library, occupations: r.occupations });
      return r;
    },
    [library, update],
  );
  return { occupations, ready, error, add, edit, remove, exportText, importText };
}
