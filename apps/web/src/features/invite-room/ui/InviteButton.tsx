"use client";
import { useEffect, useState } from "react";
import { regenerateInvite, type Invite } from "@/entities/room";
import type { Identity } from "@/entities/user";

/** KP가 초대 링크를 보고, 새로 만들고, 복사한다. */
export function InviteButton({ me, roomId }: { me: Identity; roomId: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = async () => {
    try {
      setInvite(await regenerateInvite(me, roomId));
      setOpen(true);
    } catch {
      /* 서버 오류는 룸 화면의 연결 상태로 드러난다 */
    }
  };

  // Esc로 닫을 수 있어야 아래 화면을 가리지 않는다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const link = invite ? `${window.location.origin}/join/${roomId}?invite=${invite.code}` : "";

  return (
    <>
      <button className="btn" onClick={refresh}>초대</button>
      {open && invite && (
        <div className="dialog" role="dialog" aria-label="초대 링크">
          <strong>초대 링크</strong>
          <input className="input" readOnly value={link} aria-label="초대 링크 주소" onFocus={(e) => e.currentTarget.select()} />
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
            최대 {invite.maxMembers}명 · {invite.expiresAt ? `${new Date(invite.expiresAt).toLocaleString("ko-KR")}까지` : "만료 없음"}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => navigator.clipboard?.writeText(link)}>복사</button>
            <button className="btn" onClick={refresh}>새 링크 만들기</button>
            <button className="btn" onClick={() => setOpen(false)}>닫기</button>
          </div>
        </div>
      )}
    </>
  );
}
