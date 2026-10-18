"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ERROR_TTL, INFO_TTL, humanizeError, pushToast, RECONNECTED_TEXT, SEND_FAILED_TEXT, type Toast } from "./toasts";

interface Input {
  lastError: { code: string; message?: string } | null;
  /** 연결이 없어 보내지 못한 횟수 */
  sendFailed: number;
  /** 다시 연결된 횟수 */
  reconnected: number;
}

/** 서버 오류·전송 실패·재연결을 토스트 목록으로 모은다. */
export function useRoomNotices({ lastError, sendFailed, reconnected }: Input) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    setToasts((l) => pushToast(l, { kind, text, ttl: kind === "error" ? ERROR_TTL : INFO_TTL }, nextId.current++));
  }, []);
  const dismiss = useCallback((id: number) => setToasts((l) => l.filter((t) => t.id !== id)), []);

  // 같은 오류가 연달아 와도 이벤트마다 새 객체라 매번 새 토스트가 된다.
  useEffect(() => {
    if (lastError) push("error", humanizeError(lastError));
  }, [lastError, push]);
  useEffect(() => {
    if (sendFailed > 0) push("error", SEND_FAILED_TEXT);
  }, [sendFailed, push]);
  useEffect(() => {
    if (reconnected > 0) push("info", RECONNECTED_TEXT);
  }, [reconnected, push]);

  return { toasts, dismiss };
}
