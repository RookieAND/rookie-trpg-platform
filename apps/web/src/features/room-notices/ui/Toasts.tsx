"use client";
import { useEffect } from "react";
import type { Toast } from "../model/toasts";

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  // id가 바뀌면(같은 문구가 다시 뜨면) 시간을 다시 센다.
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), toast.ttl);
    return () => clearTimeout(t);
  }, [toast.id, toast.ttl, onDismiss]);
  return (
    <div className={`toast ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"} data-testid="toast">
      <span className="toast-text">{toast.text}</span>
      <button type="button" className="toast-x" aria-label="알림 닫기" onClick={() => onDismiss(toast.id)}>×</button>
    </div>
  );
}

/** 오류·안내 토스트. 5초(안내는 3초) 뒤 사라지고 ×로 바로 닫을 수 있다. */
export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
