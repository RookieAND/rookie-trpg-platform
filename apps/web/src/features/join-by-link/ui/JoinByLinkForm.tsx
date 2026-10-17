"use client";
import { useState } from "react";

/** 초대 링크 전체를 붙여 넣어 참가한다. */
export function JoinByLinkForm({ onJoin, onError }: { onJoin: (roomId: string, invite: string) => void; onError: (message: string) => void }) {
  const [text, setText] = useState("");

  const submit = () => {
    try {
      const u = new URL(text.trim(), window.location.origin);
      const m = /\/join\/([^/]+)/.exec(u.pathname);
      const invite = u.searchParams.get("invite");
      if (m?.[1] && invite) return onJoin(m[1], invite);
    } catch {
      /* 아래 안내로 */
    }
    onError("초대 링크를 통째로 붙여 넣어 주세요.");
  };

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input className="input" aria-label="초대 링크" placeholder="초대 링크로 참가" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <button className="btn" disabled={!text.trim()} onClick={submit}>참가</button>
    </div>
  );
}
