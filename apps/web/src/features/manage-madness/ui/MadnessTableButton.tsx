"use client";
import { useState } from "react";
import { MAX_MADNESS_ENTRIES, type ClientCommand } from "@coc-vtt/shared";
import { Dialog } from "@/shared/ui";

/** GM이 광기 증상표를 적는다. 한 줄이 증상 하나이고, 증상표는 GM에게만 보인다. */
export function MadnessTableButton({ entries, indefinite = [], send }: { entries: string[]; indefinite?: string[]; send: (c: ClientCommand) => unknown }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [longText, setLongText] = useState("");

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const longLines = longText.split("\n").map((l) => l.trim()).filter(Boolean);
  const tooMany = lines.length > MAX_MADNESS_ENTRIES || longLines.length > MAX_MADNESS_ENTRIES;

  return (
    <>
      <button
        className="btn"
        onClick={() => {
          setText(entries.join("\n"));
          setLongText(indefinite.join("\n"));
          setOpen(true);
        }}
      >
        광기표
      </button>
      {open && (
        <Dialog label="광기 증상표" onClose={() => setOpen(false)} className="dialog">
          <strong>광기 설정</strong>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>한 줄에 증상 하나, 최대 {MAX_MADNESS_ENTRIES}개예요. 룰북 표를 직접 옮겨 적거나 시나리오에 맞게 고쳐 쓰세요. 참가자에게는 보이지 않아요.</span>
          <label style={{ display: "grid", gap: 4 }}>
            <b>일시적 광기 증상표</b>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>광기 판정에 성공하지 못했을 때 몇 라운드(실시간)·몇 시간(요약) 동안 보이는 증상이에요. 굴리면 이 중 하나가 나와요.</span>
            <textarea className="input" aria-label="증상 목록" style={{ height: 140, padding: 12 }} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <b>장기적 광기 목록</b>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>하루에 SAN의 1/5 이상 잃어 오래가는 광기가 됐을 때의 공포증·집착·망상 같은 항목이에요. 기간 없이 하나만 뽑아요.</span>
            <textarea className="input" aria-label="장기적 광기 목록" style={{ height: 120, padding: 12 }} value={longText} onChange={(e) => setLongText(e.target.value)} />
          </label>
          {tooMany && <span className="err" role="alert">{MAX_MADNESS_ENTRIES}줄까지만 저장할 수 있어요.</span>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn primary"
              disabled={tooMany}
              onClick={() => {
                if (send({ type: "settings.madness", data: { entries: lines.map((l) => l.slice(0, 120)), indefinite: longLines.map((l) => l.slice(0, 120)) } }) !== false) setOpen(false);
              }}
            >
              저장
            </button>
            <button className="btn" onClick={() => setOpen(false)}>닫기</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
