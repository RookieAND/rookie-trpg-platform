"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientCommand } from "@coc-vtt/shared";
import { buildCues, filterCues, type Cue, type CueSource } from "../model/cues";
import { assignSlot, clearSlot, emptySlots, parseSlots, SLOT_COUNT, type Slots } from "../model/slots";
import { Dialog } from "@/shared/ui";

const isTyping = (el: Element | null) => el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/**
 * KP 화면 아래의 연출 바(슬롯 1~9, 숫자 키로 실행)와 Cmd/Ctrl+K 명령어 검색.
 * 슬롯 배치는 KP의 개인 설정이라 룸별로 이 브라우저에만 저장한다.
 */
export function StageCues({ roomId, source, enabled, send }: { roomId: string; source: CueSource; enabled: boolean; send: (c: ClientCommand) => unknown }) {
  const storageKey = `coc-vtt.slots.${roomId}`;
  const [slots, setSlots] = useState<Slots>(emptySlots);
  // null이면 닫힘, "run"이면 실행용, 숫자면 그 슬롯에 등록하는 용도
  const [palette, setPalette] = useState<null | "run" | number>(null);

  useEffect(() => {
    try {
      setSlots(parseSlots(localStorage.getItem(storageKey)));
    } catch {
      /* 저장소를 못 쓰면 빈 슬롯으로 시작한다 */
    }
  }, [storageKey]);

  const update = (next: Slots) => {
    setSlots(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* 이번 탭에서만 유지된다 */
    }
  };

  const cues = useMemo(() => buildCues(source), [source]);
  const byId = useMemo(() => new Map(cues.map((c) => [c.id, c])), [cues]);
  const run = (cue: Cue) => enabled && send(cue.command);

  const slotsRef = useRef({ slots, byId, enabled, palette });
  slotsRef.current = { slots, byId, enabled, palette };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => (p === null ? "run" : null));
        return;
      }
      const cur = slotsRef.current;
      if (cur.palette !== null || e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) return;
      if (/^[1-9]$/.test(e.key)) {
        const id = cur.slots[Number(e.key) - 1];
        const cue = id ? cur.byId.get(id) : undefined;
        if (cue && cur.enabled) send(cue.command);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  return (
    <>
      <div className="cuebar" data-testid="cuebar" role="toolbar" aria-label="연출 바">
        <span className="dock-label" title="칸에 장면·핸드아웃을 등록해 두면 숫자 키(1~9)로 바로 실행해요. ⌘K로 검색해도 돼요">단축키</span>
        {Array.from({ length: SLOT_COUNT }, (_, i) => {
          const id = slots[i];
          const cue = id ? byId.get(id) : undefined;
          // 이미 진행 중인 장면을 가리키는 슬롯은 "없음"이 아니라 "현재 장면"으로 보여 준다.
          const current = Boolean(id) && !cue && id!.startsWith(`scene:${source.activeSceneId}:`);
          return (
            <div key={i} className="cue-slot">
              <button
                className="cue-btn"
                data-filled={Boolean(id)}
                disabled={Boolean(id) && (!cue || !enabled)}
                title={cue ? cue.label : current ? "지금 진행 중인 장면이에요" : id ? "대상이 없어졌어요" : "비어 있어요. 눌러서 등록해요"}
                aria-label={`슬롯 ${i + 1}${cue ? `: ${cue.label}` : current ? ": 현재 장면" : id ? ": 대상 없음" : ": 비어 있음"}`}
                onClick={() => (cue ? run(cue) : setPalette(i))}
              >
                <kbd>{i + 1}</kbd>
                <span>{cue ? cue.label.split(" · ").slice(-1)[0] : current ? "현재 장면" : id ? "없음" : "+"}</span>
              </button>
              {id && <button className="cue-x" aria-label={`슬롯 ${i + 1} 비우기`} onClick={() => update(clearSlot(slots, i))}>×</button>}
            </div>
          );
        })}
        <button className="cue-btn cue-search" onClick={() => setPalette("run")} aria-label="명령어 검색">⌘K</button>
      </div>
      {palette !== null && (
        <Palette
          cues={cues}
          assigning={typeof palette === "number" ? palette : null}
          onClose={() => setPalette(null)}
          onPick={(cue) => {
            if (typeof palette === "number") update(assignSlot(slots, palette, cue.id));
            else run(cue);
            setPalette(null);
          }}
        />
      )}
    </>
  );
}

function Palette({ cues, assigning, onClose, onPick }: { cues: Cue[]; assigning: number | null; onClose: () => void; onPick: (c: Cue) => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const results = useMemo(() => filterCues(cues, query), [cues, query]);
  const active = Math.min(index, Math.max(0, results.length - 1));

  return (
    <Dialog label="명령어 검색" onClose={onClose} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 25, background: "rgba(0,0,0,.45)", display: "flex", justifyContent: "center", paddingTop: "18vh" }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 92vw)", alignSelf: "flex-start", gap: 8, padding: 12, boxShadow: "0 24px 64px rgba(0,0,0,.6)" }}>
        <input
          autoFocus
          className="input"
          aria-label="명령어 검색어"
          placeholder={assigning !== null ? `슬롯 ${assigning + 1}에 등록할 동작 검색` : "장면, 핸드아웃, 오브젝트 검색"}
          value={query}
          onChange={(e) => (setQuery(e.target.value), setIndex(0))}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setIndex(Math.min(active + 1, results.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setIndex(Math.max(active - 1, 0)));
            else if (e.key === "Enter" && results[active]) {
              // 창이 닫히며 초점이 슬롯 버튼으로 돌아가도, 이 Enter가 그 버튼을 또 누르지 않게 한다
              e.preventDefault();
              onPick(results[active]);
            }
          }}
        />
        <div role="listbox" style={{ display: "grid", gap: 2, maxHeight: "40vh", overflow: "auto" }}>
          {results.length === 0 && <div style={{ color: "var(--muted)", padding: 8 }}>일치하는 동작이 없어요.</div>}
          {results.map((c, i) => (
            <button key={c.id} role="option" aria-selected={i === active} className="cue-option" onMouseEnter={() => setIndex(i)} onClick={() => onPick(c)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
