"use client";
import { useEffect, useRef, useState } from "react";
import type { ClientCommand, GameObject } from "@coc-vtt/shared";
import { MarkerPanel } from "./MarkerPanel";

/** 선택 막대·PL 도크의 "상태 표식" 단추. 누르면 위로 표식 목록이 열린다. */
export function MarkerButton({ obj, canSecret, enabled, send }: { obj: GameObject; canSecret: boolean; enabled: boolean; send: (c: ClientCommand) => unknown }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => setOpen(false), [obj.id]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const count = obj.markers?.length ?? 0;
  return (
    <span ref={root} className="mk-anchor">
      <button type="button" className="btn" data-testid="marker-open" aria-expanded={open} aria-haspopup="true" disabled={obj.kind !== "token"} title="토큰에 기절·중독 같은 상태 표식을 붙여요" onClick={() => setOpen((o) => !o)}>
        상태 표식{count > 0 ? ` ${count}` : ""}
      </button>
      {open && (
        <div className="mk-pop" data-testid="marker-pop">
          <MarkerPanel obj={obj} canSecret={canSecret} enabled={enabled} send={send} />
        </div>
      )}
    </span>
  );
}
