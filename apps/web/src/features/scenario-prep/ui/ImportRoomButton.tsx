"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SAMPLE_SCENARIO } from "@coc-vtt/shared";
import { importNewRoom } from "@/entities/room";
import { ApiError, type Caller } from "@/shared/api";
import { downloadText } from "@/shared/lib";
import { Dialog } from "@/shared/ui";
import { previewLocal, type LocalPreview } from "../model/preview";

/**
 * 로비의 "백업에서 새 룸 만들기": 룸 백업이나 시나리오 파일로 새 룸을 만든다(템플릿 복사에도 쓴다).
 * 만든 사람이 새 룸의 GM이다. 파일을 고르면 개수와 문제를 먼저 보여 준다.
 */
export function ImportRoomButton({ me, onCreated, onError }: { me: Caller; onCreated: (roomId: string) => void; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [name, setName] = useState("");
  const [local, setLocal] = useState<LocalPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      const l = text.trim() ? previewLocal(text) : null;
      setLocal(l);
      if (l?.ok) setName((cur) => cur || l.roomName);
    }, 200);
    return () => clearTimeout(t);
  }, [text]);

  const reset = () => {
    setOpen(false);
    setText("");
    setFileName("");
    setName("");
    setLocal(null);
    setFailed([]);
    setBusy(false);
  };

  const create = async () => {
    if (!local?.ok || busy) return;
    setBusy(true);
    setFailed([]);
    try {
      const r = await importNewRoom(me, text, name.trim() || undefined);
      reset();
      onCreated(r.id);
    } catch (e) {
      const list = e instanceof ApiError ? (e.body as { errors?: string[] } | null | undefined)?.errors : undefined;
      setFailed(list?.length ? list : [e instanceof ApiError ? e.message : "룸을 만들지 못했어요."]);
      onError(e instanceof ApiError ? e.message : "룸을 만들지 못했어요.");
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn" data-testid="import-room" title="룸 백업이나 시나리오 파일로 새 룸을 만들어요" onClick={() => setOpen(true)}>백업에서 새 룸 만들기</button>
      {open &&
        createPortal(
          <Dialog
            label="백업에서 새 룸 만들기"
            onClose={reset}
            data-testid="import-room-dialog"
            style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", padding: 16 }}
            onClick={(e) => e.target === e.currentTarget && reset()}
          >
            <div className="card import-card">
              <strong>백업에서 새 룸 만들기</strong>
              <span className="import-sub">룸 백업이나 시나리오 파일을 고르면 그 내용으로 새 룸을 만들어요. 만든 내가 GM이에요.</span>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <label className="btn">
                  파일 고르기
                  <input type="file" accept=".json,application/json,text/plain" data-testid="import-room-file" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) (setFileName(f.name), setName(""), setText(await f.text())); }} />
                </label>
                <button type="button" className="btn" onClick={() => downloadText("예시-시나리오.json", JSON.stringify(SAMPLE_SCENARIO, null, 2), "application/json;charset=utf-8")}>예시 받기</button>
                {fileName && <span className="import-sub">{fileName}</span>}
              </div>
              {local?.ok && (
                <>
                  <div data-testid="import-room-counts"><strong>{local.kind === "backup" ? "룸 백업" : "시나리오"}</strong> · {local.line || "비어 있어요"}</div>
                  <input className="input" aria-label="새 룸 이름" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
                </>
              )}
              {(local && !local.ok ? local.errors : failed).length > 0 && (
                <ul className="import-list err" role="alert" data-testid="import-room-errors">
                  {(local && !local.ok ? local.errors : failed).slice(0, 12).map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={reset}>취소</button>
                <button type="button" className="btn primary" data-testid="import-room-apply" disabled={!local?.ok || !name.trim() || busy} onClick={create}>{busy ? "만드는 중…" : "새 룸 만들기"}</button>
              </div>
            </div>
          </Dialog>,
          document.body,
        )}
    </>
  );
}
