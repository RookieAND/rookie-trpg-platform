"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Upload } from "lucide-react";
import { SHEET_CSV_MAX_CHARS, decodeCsvBytes, deriveCharacter, josa, parseGoogleSheetUrl, parseSheetCsv, type CharacterData } from "@coc-vtt/shared";
import { ApiError, type Caller } from "@/shared/api";
import { fetchGoogleSheetCsv } from "../api/google-sheet-api";
import { downloadSheetTemplate } from "../lib/csv-files";

const MAX_SHOWN = 30;

/**
 * CSV로 가져오기: 파일, 붙여넣기, 구글 시트 링크 어느 쪽이든 같은 미리보기를 거친다.
 * 미리보기에서 확인한 뒤에만 onApply로 넘기고, 여기서는 아무것도 저장하지 않는다.
 * 구글 시트는 한 번 읽어 오기만 한다(계속 연결되거나 시트에 다시 쓰지 않는다).
 */
export function SheetCsvImport({ me, applyLabel, onApply, disabled = false, children }: { me: Caller; applyLabel: string; onApply: (data: CharacterData) => void; disabled?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="csv" data-testid="csv-tools">
      <div className="row">
        <button type="button" className="btn" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)}><Upload aria-hidden />CSV로 가져오기</button>
        <button type="button" className="btn ghost" onClick={downloadSheetTemplate} title="구글 시트나 엑셀에 올려서 채우는 빈 양식이에요"><Download aria-hidden />양식 받기</button>
        {children && <span className="spacer-right">{children}</span>}
      </div>
      {open && (
        <ImportPanel
          me={me}
          applyLabel={applyLabel}
          onApply={(d) => {
            onApply(d);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function ImportPanel({ me, applyLabel, onApply, onClose }: { me: Caller; applyLabel: string; onApply: (data: CharacterData) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const result = useMemo(() => (text.trim() === "" ? null : parseSheetCsv(text)), [text]);

  const takeText = (value: string, from: string) => {
    setText(value);
    setProblem(null);
    setInfo(from);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > SHEET_CSV_MAX_CHARS) return setProblem("파일이 너무 커요. 1MB까지 가져올 수 있어요.");
    try {
      const { text: t, encoding } = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      takeText(t, encoding === "utf-8" ? `${josa(`'${file.name}'`, "을/를")} 읽었어요.` : `${josa(`'${file.name}'`, "을/를")} 한글 윈도우 인코딩(EUC-KR)으로 읽었어요.`);
    } catch {
      setProblem("파일을 읽지 못했어요.");
    }
  };

  const fromGoogle = async () => {
    setInfo(null);
    if (!parseGoogleSheetUrl(url)) return setProblem("구글 시트 링크가 아니에요. docs.google.com/spreadsheets/d/… 로 시작해야 해요.");
    setBusy(true);
    setProblem(null);
    try {
      takeText(await fetchGoogleSheetCsv(me, url), "구글 시트를 한 번 읽어 왔어요. 시트를 고쳐도 여기에는 자동으로 반영되지 않아요.");
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const d = result?.data;
  const limits = d ? deriveCharacter({ characteristics: d.characteristics, age: d.age }).limits : null;
  const shownWarn = result ? result.warnings.slice(0, MAX_SHOWN) : [];
  const shownNotes = result ? result.notes.slice(0, Math.max(0, MAX_SHOWN - shownWarn.length)) : [];
  const hidden = result ? result.warnings.length + result.notes.length - shownWarn.length - shownNotes.length : 0;

  return (
    <section className="card csv-panel" role="region" aria-label="CSV 가져오기" data-testid="csv-import">
      <strong>CSV·구글 시트에서 가져오기</strong>
      <p className="res-sub csv-lead">한 번 읽어 오는 기능이에요. 구글 시트와 계속 이어지지 않고, 시트에 다시 써 주지도 않아요.</p>

      <div className="csv-step">
        <span className="section-title">1. 파일이나 표 붙여넣기</span>
        <div className="row">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>파일 고르기</button>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" aria-label="CSV 파일" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        <textarea className="input mono csv-text" aria-label="CSV 붙여넣기" placeholder="구글 시트나 엑셀의 표를 복사해 붙여 넣거나, CSV 글을 그대로 적어요" value={text} onChange={(e) => e.target.value !== text.replace(/\r\n?/g, "\n") && takeText(e.target.value, "")} spellCheck={false} />
      </div>

      <div className="csv-step">
        <span className="section-title">또는 구글 시트 링크</span>
        <div className="row">
          <input className="input" aria-label="구글 시트 링크" placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void fromGoogle()} />
          <button type="button" className="btn" disabled={busy || url.trim() === ""} onClick={() => void fromGoogle()}>{busy ? "읽는 중…" : "링크로 읽기"}</button>
        </div>
        <div className="res-sub">시트 공유를 ‘링크가 있는 모든 사용자 - 보기’로 바꿔야 해요. 서버가 CSV를 한 번 받아 와요(1MB, 8초까지).</div>
      </div>

      {problem && <div className="err" role="alert" data-testid="csv-problem">{problem}</div>}
      {info && !problem && <div className="res-sub" role="status">{info}</div>}

      {result && (
        <div className="csv-result" data-testid="csv-result">
          <span className="section-title">2. 미리보기</span>
          {result.errors.length > 0 && (
            <div className="err" role="alert" data-testid="csv-errors">
              <div>가져올 수 없어요. 아래를 고쳐 주세요.</div>
              <ul className="csv-list">
                {result.errors.map((e, i) => <li key={i}>{e.row ? `${e.row}행: ` : ""}{e.message}</li>)}
              </ul>
            </div>
          )}
          {d && limits && (
            <div className="csv-summary" data-testid="csv-preview">
              <div><strong>{d.name}</strong> <span className="res-sub">{d.occupation || "직업 없음"} · {d.age}세</span></div>
              <div className="mono csv-line">
                {(["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU"] as const).map((k) => `${k} ${d.characteristics[k]}`).join(" · ")}
              </div>
              <div className="mono csv-line">
                HP {d.hp ?? limits.hp}/{limits.hp} · MP {d.mp ?? limits.mp}/{limits.mp} · SAN {d.san ?? d.characteristics.POW}/{limits.san} · 행운 {d.luck ?? 0}
              </div>
              <div className="res-sub">
                기능 {d.skills.length}개(성장 표시 {d.skills.filter((s) => s.grown).length}개) · 무기 {d.weapons.length}개{d.possessions ? " · 소지품 있음" : ""}{d.notes || d.backstory ? " · 비고 있음" : ""}
              </div>
            </div>
          )}
          {(result.warnings.length > 0 || result.notes.length > 0) && (
            <details className="csv-warn" data-testid="csv-warnings" open={result.skippedRows > 0}>
              <summary>
                {result.skippedRows > 0 ? `건너뛴 행 ${result.skippedRows}개` : "알아 둘 점"}
                {result.warnings.length + result.notes.length > result.skippedRows ? ` · 알림 ${result.warnings.length + result.notes.length - result.skippedRows}개` : ""}
              </summary>
              <ul className="csv-list">
                {shownWarn.map((w, i) => <li key={`w${i}`}>{w.row ? `${w.row}행: ` : ""}{w.message}</li>)}
                {shownNotes.map((w, i) => <li key={`n${i}`} className="csv-note">{w.row ? `${w.row}행: ` : ""}{w.message}</li>)}
                {hidden > 0 && <li className="csv-note">그 밖에 {hidden}개가 더 있어요.</li>}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="row csv-actions">
        <button type="button" className="btn primary" data-testid="csv-apply" disabled={!d} onClick={() => d && onApply(d)}>{applyLabel}</button>
        <button type="button" className="btn ghost" onClick={onClose}>닫기</button>
      </div>
    </section>
  );
}
