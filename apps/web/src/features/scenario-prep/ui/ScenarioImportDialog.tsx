"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SAMPLE_SCENARIO } from "@coc-vtt/shared";
import { importScenario, type ScenarioImportResult } from "@/entities/room";
import { ApiError, type Caller } from "@/shared/api";
import { downloadText } from "@/shared/lib";
import { Dialog } from "@/shared/ui";
import { previewLocal, type LocalPreview } from "../model/preview";

type Server =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; result: ScenarioImportResult }
  | { state: "error"; errors: string[] };

/** 서버 오류에서 위치별 문제 목록을 꺼낸다. */
function errorList(e: unknown): string[] {
  if (e instanceof ApiError) {
    const list = (e.body as { errors?: string[] } | null | undefined)?.errors;
    return list?.length ? list : [e.message];
  }
  return ["서버에 연결하지 못했어요. 잠시 뒤에 다시 해 주세요."];
}

/**
 * 시나리오·백업 파일을 현재 룸에 더한다. 파일을 고르거나 글을 붙여 넣으면 먼저 미리 본다
 * (브라우저에서 형식을 보고, 서버에서 한도·이미지·PL 이름까지 확인한다). 문제가 하나라도 있으면 가져오지 않는다.
 */
export function ScenarioImportDialog({ me, roomId, onClose, onImported }: { me: Caller; roomId: string; onClose: () => void; onImported: (r: ScenarioImportResult) => void }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [local, setLocal] = useState<LocalPreview | null>(null);
  const [server, setServer] = useState<Server>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const run = useRef(0);

  // 글이 바뀌면 잠깐 뒤에 미리 본다. 늦게 온 응답은 버린다.
  useEffect(() => {
    const n = ++run.current;
    if (!text.trim()) {
      setLocal(null);
      setServer({ state: "idle" });
      return;
    }
    const t = setTimeout(async () => {
      const l = previewLocal(text);
      if (n !== run.current) return;
      setLocal(l);
      if (!l.ok) return setServer({ state: "idle" });
      setServer({ state: "checking" });
      try {
        const result = await importScenario(me, roomId, text, true);
        if (n === run.current) setServer({ state: "ok", result });
      } catch (e) {
        if (n === run.current) setServer({ state: "error", errors: errorList(e) });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [text, me, roomId]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setText(await file.text());
  };

  const ready = local?.ok === true && server.state === "ok";
  const apply = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const result = await importScenario(me, roomId, text, false);
      onImported(result);
      onClose();
    } catch (e) {
      setServer({ state: "error", errors: errorList(e) });
      setBusy(false);
    }
  };

  const errors = local && !local.ok ? local.errors : server.state === "error" ? server.errors : [];
  const warnings = [...(local?.ok ? local.warnings : []), ...(server.state === "ok" ? server.result.warnings : [])];

  return createPortal(
    <Dialog
      label="시나리오 가져오기"
      onClose={onClose}
      data-testid="import-dialog"
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card import-card">
        <strong>시나리오 가져오기</strong>
        <span className="import-sub">시나리오 파일이나 룸 백업을 이 룸에 더해요. 지금 있는 것은 지워지지 않고, 가져온 직후에는 되돌릴 수 있어요.</span>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <label className="btn">
            파일 고르기
            <input type="file" accept=".json,application/json,text/plain" data-testid="import-file" style={{ display: "none" }} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <button type="button" className="btn" data-testid="import-sample" onClick={() => downloadText("예시-시나리오.json", JSON.stringify(SAMPLE_SCENARIO, null, 2), "application/json;charset=utf-8")}>예시 받기</button>
          {fileName && <span className="import-sub" data-testid="import-filename">{fileName}</span>}
        </div>
        <textarea className="input import-text" data-testid="import-text" aria-label="시나리오 글" placeholder="또는 여기에 시나리오 글을 붙여 넣어요" value={text} onChange={(e) => (setFileName(""), setText(e.target.value))} spellCheck={false} />

        <div role="status" aria-live="polite" data-testid="import-preview" className="import-preview">
          {server.state === "checking" && <span className="import-sub">확인하는 중…</span>}
          {local?.ok && server.state === "ok" && (
            <>
              <div data-testid="import-counts"><strong>{local.kind === "backup" ? "룸 백업" : "시나리오"}</strong> · {countsText(server.result)}</div>
              {server.result.reusedScene && <div className="import-sub">비어 있는 첫 장면을 첫 장면으로 써요.</div>}
            </>
          )}
        </div>
        {errors.length > 0 && (
          <ul className="import-list err" role="alert" data-testid="import-errors">
            {errors.slice(0, 12).map((m, i) => <li key={i}>{m}</li>)}
            {errors.length > 12 && <li>… 그 밖에 {errors.length - 12}곳</li>}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul className="import-list warn" data-testid="import-warnings">
            {warnings.slice(0, 12).map((m, i) => <li key={i}>{m}</li>)}
            {warnings.length > 12 && <li>… 그 밖에 {warnings.length - 12}건</li>}
          </ul>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button type="button" className="btn primary" data-testid="import-apply" disabled={!ready || busy} onClick={apply}>{busy ? "가져오는 중…" : "가져오기"}</button>
        </div>
      </div>
    </Dialog>,
    document.body,
  );
}

function countsText(r: ScenarioImportResult): string {
  const c = r.counts;
  const parts: Array<[string, number]> = [["장면", c.scenes], ["토큰·소품", c.tokens], ["시트", c.characters], ["핸드아웃", c.handouts], ["비트", c.beats], ["분기", c.branches], ["음원", c.audio], ["이미지", c.images], ["광기표", c.madness]];
  const line = parts.filter(([, n]) => n > 0).map(([l, n]) => `${l} ${n}`).join(" · ");
  return line || "가져올 것이 없어요";
}
