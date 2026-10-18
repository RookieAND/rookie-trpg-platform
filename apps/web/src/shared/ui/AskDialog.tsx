"use client";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "./Dialog";
import { promptResult } from "./ask-dialog";

export type ConfirmOptions = {
  title: string;
  /** 제목 아래 한 줄 설명(되돌릴 수 있는지 등) */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 지우기처럼 되돌리기 어려운 동작이면 붉은 버튼 */
  danger?: boolean;
};
export type PromptOptions = Omit<ConfirmOptions, "danger"> & { label: string; initial: string; maxLength?: number };

type Pending =
  | { kind: "confirm"; opts: ConfirmOptions; done: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; done: (v: string | null) => void };

/**
 * 브라우저 기본 confirm/prompt 대신 쓰는 화면 안 확인 창.
 * `const ask = useAsk();` 로 받아 `await ask.confirm({...})`, `await ask.prompt({...})`를 부르고,
 * 컴포넌트가 `{ask.node}`를 어딘가에 그려 둔다. 초점은 창 안에 갇히고 Esc나 취소는 false/null이다.
 */
export function useAsk() {
  const [pending, setPending] = useState<Pending | null>(null);
  const live = useRef<Pending | null>(null);

  const open = useCallback((p: Pending) => {
    // 이미 떠 있는 창은 취소로 닫는다.
    const prev = live.current;
    if (prev) prev.done(prev.kind === "confirm" ? (false as never) : (null as never));
    live.current = p;
    setPending(p);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => open({ kind: "confirm", opts, done: resolve })), [open]);
  const prompt = useCallback((opts: PromptOptions) => new Promise<string | null>((resolve) => open({ kind: "prompt", opts, done: resolve })), [open]);

  const finish = (p: Pending, value: boolean | string | null) => {
    if (live.current !== p) return;
    live.current = null;
    setPending(null);
    (p.done as (v: unknown) => void)(value);
  };

  const node: ReactNode = pending ? <AskView key={pending.kind + pending.opts.title} pending={pending} onFinish={(v) => finish(pending, v)} /> : null;
  return { confirm, prompt, node };
}

function AskView({ pending, onFinish }: { pending: Pending; onFinish: (v: boolean | string | null) => void }) {
  const { opts } = pending;
  const [text, setText] = useState(pending.kind === "prompt" ? pending.opts.initial : "");
  const cancel = () => onFinish(pending.kind === "confirm" ? false : null);
  const ok = () => {
    if (pending.kind === "confirm") return onFinish(true);
    const v = promptResult(text, pending.opts.initial);
    onFinish(v);
  };
  const danger = pending.kind === "confirm" && pending.opts.danger;

  return createPortal(
    <Dialog
      label={opts.title}
      onClose={cancel}
      data-testid="ask-dialog"
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && cancel()}
    >
      <form
        className="card"
        style={{ width: "min(380px, 100%)", padding: 16, gap: 10, background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow)" }}
        onSubmit={(e) => (e.preventDefault(), ok())}
      >
        <strong>{opts.title}</strong>
        {opts.message && <div style={{ color: "var(--muted)" }}>{opts.message}</div>}
        {pending.kind === "prompt" && (
          <input className="input" aria-label={pending.opts.label} value={text} maxLength={pending.opts.maxLength ?? 40} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setText(e.target.value)} />
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={cancel}>{opts.cancelLabel ?? "취소"}</button>
          <button type="submit" className={`btn ${danger ? "danger" : "primary"}`} disabled={pending.kind === "prompt" && !text.trim()}>
            {opts.confirmLabel ?? (pending.kind === "prompt" ? "저장" : "확인")}
          </button>
        </div>
      </form>
    </Dialog>,
    document.body,
  );
}
