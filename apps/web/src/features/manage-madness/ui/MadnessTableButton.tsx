"use client";
import { useEffect, useState } from "react";
import { MAX_MADNESS_ENTRIES, type ClientCommand } from "@coc-vtt/shared";

/** KP가 광기 증상표를 적는다. 한 줄이 증상 하나이고, 증상표는 KP에게만 보인다. */
export function MadnessTableButton({ entries, send }: { entries: string[]; send: (c: ClientCommand) => unknown }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const tooMany = lines.length > MAX_MADNESS_ENTRIES;

  return (
    <>
      <button
        className="btn"
        onClick={() => {
          setText(entries.join("\n"));
          setOpen(true);
        }}
      >
        광기표
      </button>
      {open && (
        <div className="dialog" role="dialog" aria-label="광기 증상표">
          <strong>광기 증상표</strong>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>한 줄에 증상 하나, 최대 {MAX_MADNESS_ENTRIES}개예요. 룰북 표를 직접 옮겨 적거나 시나리오에 맞게 고쳐 쓰세요. 참가자에게는 보이지 않아요.</span>
          <textarea className="input" aria-label="증상 목록" style={{ height: 180, padding: 12 }} value={text} onChange={(e) => setText(e.target.value)} />
          {tooMany && <span className="err" role="alert">{MAX_MADNESS_ENTRIES}줄까지만 저장할 수 있어요.</span>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn primary"
              disabled={tooMany}
              onClick={() => {
                if (send({ type: "settings.madness", data: { entries: lines.map((l) => l.slice(0, 120)) } }) !== false) setOpen(false);
              }}
            >
              저장
            </button>
            <button className="btn" onClick={() => setOpen(false)}>닫기</button>
          </div>
        </div>
      )}
    </>
  );
}
