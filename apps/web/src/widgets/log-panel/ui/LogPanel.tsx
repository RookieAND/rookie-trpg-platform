"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LOG_KINDS, LOG_KIND_LABEL_KO, type LogEntryView } from "@coc-vtt/shared";
import { getSessionLog } from "@/entities/room";
import type { Caller } from "@/shared/api";
import { downloadText } from "@/shared/lib";
import { EMPTY_FILTER, buildExport, fetchAllLog, filterToQuery, toggleKind, type LogFilter } from "../model/log-view";

export interface LogPanelProps {
  me: Caller;
  roomId: string;
  roomTitle: string;
  isKp: boolean;
  /** 지금까지 시작한 세션 수(세션 고르기 목록) */
  sessionCount: number;
  /** 이 탭을 보고 있는가 */
  visible: boolean;
  /** 값이 바뀌면 기록을 다시 불러온다(새 굴림·진행이 생겼다는 뜻) */
  version: string;
}

const PAGE = 100;

export function LogPanel({ me, roomId, roomTitle, isKp, sessionCount, visible, version }: LogPanelProps) {
  const [filter, setFilter] = useState<LogFilter>(EMPTY_FILTER);
  const [asPublic, setAsPublic] = useState(false);
  const [entries, setEntries] = useState<LogEntryView[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const seq = useRef(0);
  const view = isKp && asPublic ? ("public" as const) : undefined;

  const load = useCallback(async () => {
    const my = ++seq.current;
    setState("loading");
    try {
      const page = await getSessionLog(me, roomId, { ...filterToQuery(filter, view), limit: PAGE });
      if (my !== seq.current) return;
      setEntries(page.entries);
      setHasMore(page.hasMore);
      setTotal(page.total);
      setState("idle");
    } catch {
      if (my === seq.current) setState("error");
    }
  }, [me, roomId, filter, view]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load, version]);

  const more = async () => {
    const first = entries[0];
    if (!first) return;
    setState("loading");
    try {
      const page = await getSessionLog(me, roomId, { ...filterToQuery(filter, view), limit: PAGE, before: first.n });
      setEntries((cur) => [...page.entries, ...cur]);
      setHasMore(page.hasMore);
      setState("idle");
    } catch {
      setState("error");
    }
  };

  const exportAs = async (kind: "md" | "json") => {
    setBusy(true);
    setNote(null);
    try {
      // 필터와 상관없이 이 보기의 전체 기록을 내보낸다.
      const all = await fetchAllLog((q) => getSessionLog(me, roomId, { ...q, ...(view ? { view } : {}) }));
      const out = buildExport(kind, all.entries, { title: roomTitle, audience: all.audience, now: new Date() });
      downloadText(out.filename, out.text, out.mime);
      if (!all.complete) setNote("기록이 많아 오래된 일부는 담지 못했어요.");
    } catch {
      setNote("내보내지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const filtered = filter.kinds.length > 0 || filter.session > 0 || filter.since !== "" || filter.until !== "";

  return (
    <div className="logp" data-testid="log-panel" hidden={!visible}>
      <div className="logp-bar">
        <div className="logp-kinds" role="group" aria-label="종류">
          {LOG_KINDS.map((k) => (
            <button key={k} type="button" className="chip" data-testid={`log-kind-${k}`} aria-pressed={filter.kinds.includes(k)} onClick={() => setFilter((f) => ({ ...f, kinds: toggleKind(f.kinds, k) }))}>
              {LOG_KIND_LABEL_KO[k]}
            </button>
          ))}
        </div>
        <div className="logp-row">
          <label className="chat-sel">
            <span className="muted">세션</span>
            <select className="input" data-testid="log-session" value={filter.session} onChange={(e) => setFilter((f) => ({ ...f, session: Number(e.target.value) }))}>
              <option value={0}>전체</option>
              {Array.from({ length: sessionCount }, (_, i) => (
                <option key={i + 1} value={i + 1}>세션 {i + 1}</option>
              ))}
            </select>
          </label>
          <label className="chat-sel">
            <span className="muted">부터</span>
            <input className="input" type="datetime-local" lang="ko" aria-label="시작 일시 (연·월·일, 시·분)" data-testid="log-since" value={filter.since} onChange={(e) => setFilter((f) => ({ ...f, since: e.target.value }))} />
          </label>
          <label className="chat-sel">
            <span className="muted">까지</span>
            <input className="input" type="datetime-local" lang="ko" aria-label="끝 일시 (연·월·일, 시·분)" data-testid="log-until" value={filter.until} onChange={(e) => setFilter((f) => ({ ...f, until: e.target.value }))} />
          </label>
        </div>
        <div className="logp-row logp-actions">
          {filtered && <button type="button" className="btn sm" data-testid="log-reset" onClick={() => setFilter(EMPTY_FILTER)}>필터 지우기</button>}
          {isKp && (
            <label className="chat-plw">
              <input type="checkbox" data-testid="log-as-public" checked={asPublic} onChange={(e) => setAsPublic(e.target.checked)} /> 참가자용으로 보기
            </label>
          )}
          <button type="button" className="btn sm" data-testid="log-export-md" disabled={busy} onClick={() => exportAs("md")}>마크다운 저장</button>
          <button type="button" className="btn sm" data-testid="log-export-json" disabled={busy} onClick={() => exportAs("json")}>JSON 저장</button>
        </div>
        {isKp && <p className="muted logp-note" data-testid="log-audience">{asPublic ? "참가자에게 보이는 기록만 보여요." : "GM용 기록이에요. 비밀 굴림 결과와 GM만 아는 내용이 들어 있어요."}</p>}
        {note && <p className="muted logp-note" role="status">{note}</p>}
      </div>
      <ol className="logp-list" data-testid="log-list" aria-label="세션 기록">
        {hasMore && (
          <li>
            <button type="button" className="btn sm" data-testid="log-more" disabled={state === "loading"} onClick={more}>이전 기록 더 보기</button>
          </li>
        )}
        {entries.length === 0 && state !== "loading" && <li className="muted" data-testid="log-empty">{state === "error" ? "기록을 불러오지 못했어요." : filtered ? "조건에 맞는 기록이 없어요." : "아직 기록이 없어요."}</li>}
        {entries.map((e) => (
          <LogItem key={e.n} e={e} />
        ))}
      </ol>
      <div className="muted logp-foot" data-testid="log-total">{state === "loading" ? "불러오는 중…" : `${total}건`}</div>
    </div>
  );
}

const hm = (at: number) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));

function LogItem({ e }: { e: LogEntryView }) {
  return (
    <li className={`logp-item k-${e.kind}`} data-testid="log-item" data-kind={e.kind}>
      <div className="logp-meta">
        <span className="badge plain">{LOG_KIND_LABEL_KO[e.kind]}</span>
        {e.scope && <span className="badge kp">GM 전용</span>}
        {e.scene && <span className="muted logp-scene">{e.scene}</span>}
        <time className="muted">{hm(e.at)}</time>
      </div>
      {e.roll ? (
        <div className="logp-text">
          <b>{e.roll.who}</b> <code>{e.roll.expr}</code> → {e.roll.result}
          {e.roll.tags.length > 0 && <span className="muted"> ({e.roll.tags.join(", ")})</span>}
        </div>
      ) : e.chat ? (
        <div className="logp-text"><b>{e.chat.name}</b> {e.chat.text}</div>
      ) : (
        <div className="logp-text">{e.text}</div>
      )}
    </li>
  );
}
