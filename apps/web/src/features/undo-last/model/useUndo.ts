"use client";
import { useCallback, useEffect } from "react";
import type { ClientCommand } from "@coc-vtt/shared";
import { isUndoKey, undoHint } from "./shortcut";

/**
 * GM의 되돌리기. Ctrl/⌘+Z 를 `undo.last` 로 보내고, 되돌릴 수 있는 삭제 동작에는 안내 토스트를 붙인 send 를 돌려준다.
 */
export function useUndo({ enabled, send, notify }: { enabled: boolean; send: (c: ClientCommand) => boolean; notify: (text: string) => void }) {
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
      const hint = ok ? undoHint(c.type) : null;
      if (hint) notify(hint);
      return ok;
    },
    [send, notify],
  );
  return { undo, sendWithHint };
}
