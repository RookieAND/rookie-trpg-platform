"use client";
import { useCallback, useEffect } from "react";
import type { ClientCommand } from "@coc-vtt/shared";
import { isUndoKey, undoHint } from "./shortcut";

/**
 * GM의 되돌리기. Ctrl/⌘+Z 를 `undo.last` 로 보내고, 되돌릴 수 있는 삭제 동작에는 안내 토스트를 붙인 send 를 돌려준다.
 */
export function useUndo({ enabled, send, notify }: { enabled: boolean; send: (c: ClientCommand) => boolean; notify: (text: string, action?: { label: string; run: () => void }) => void }) {
  const undo = useCallback(() => send({ type: "undo.last", data: {} }), [send]);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isUndoKey(e)) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, undo]);
  const sendWithHint = useCallback(
    (c: ClientCommand) => {
      const ok = send(c);
      // 터치 기기에는 Ctrl+Z가 없으니 문구 대신 토스트의 버튼으로 되돌린다.
      const touch = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
      const hint = ok ? undoHint(c.type, touch) : null;
      if (hint) notify(hint, { label: "되돌리기", run: undo });
      return ok;
    },
    [send, notify, undo],
  );
  return { undo, sendWithHint };
}
