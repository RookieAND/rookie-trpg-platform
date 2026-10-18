"use client";
import { useEffect, useState } from "react";

/** 연결이 끊겼을 때 보드 위에 세우는 한 줄 배너. 처음 접속하는 동안은 띄우지 않는다. */
export function ConnectionBanner({ connection, retry }: { connection: "connecting" | "open" | "closed"; retry: { attempt: number; nextAt: number | null } }) {
  const [now, setNow] = useState(() => Date.now());
  const waiting = connection === "closed" && retry.nextAt !== null;
  useEffect(() => {
    if (!waiting) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [waiting, retry.nextAt]);

  if (connection === "open") return null;
  if (connection === "connecting" && retry.attempt === 0) return null;
  const n = retry.attempt > 0 ? ` (${retry.attempt}번째)` : "";
  const text = waiting
    ? `연결이 끊겼어요. ${Math.max(0, Math.ceil((retry.nextAt! - now) / 1000))}초 뒤에 다시 연결해요${n}`
    : connection === "connecting"
      ? `다시 연결하는 중이에요${n}`
      : "연결이 끊겼어요";
  return (
    <div className="conn-banner" role="status" data-testid="conn-banner">
      <span className="conn-dot" aria-hidden />
      {text}
      <span className="conn-sub">지금 하는 조작은 전달되지 않아요</span>
    </div>
  );
}
