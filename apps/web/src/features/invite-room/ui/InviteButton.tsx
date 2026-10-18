"use client";
import { useState } from "react";
import { getRoom, regenerateInvite, type Invite } from "@/entities/room";
import type { Identity } from "@/entities/user";
import { Dialog } from "@/shared/ui";

const EXPIRY: Array<{ label: string; minutes: number | null }> = [
  { label: "만료 없음", minutes: null },
  { label: "1시간", minutes: 60 },
  { label: "하루", minutes: 60 * 24 },
  { label: "7일", minutes: 60 * 24 * 7 },
];

/**
 * KP가 초대 링크를 보고 복사한다. 창을 여는 것만으로는 링크가 바뀌지 않는다.
 * 만료·인원을 정해 "새 링크 만들기"를 누를 때만 새 코드가 발급되고, 이전 링크는 못 쓰게 된다.
 */
export function InviteButton({ me, roomId }: { me: Identity; roomId: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [max, setMax] = useState(8);

  const show = async () => {
    setError(null);
    setCopied(false);
    try {
      const room = await getRoom(me, roomId);
      // 이미 발급된 링크가 있으면 그대로 보여 준다. 정보가 없을 때만 처음 발급한다.
      const current = room.invite ?? (await regenerateInvite(me, roomId));
      setInvite(current);
      setMax(current.maxMembers);
      setOpen(true);
    } catch {
      setError("초대 링크를 불러오지 못했어요. 잠시 뒤에 다시 눌러 주세요.");
      setOpen(true);
    }
  };

  const renew = async () => {
    if (invite && !window.confirm("새 링크를 만들면 이전에 보낸 링크는 못 써요. 만들까요?")) return;
    setError(null);
    setCopied(false);
    try {
      setInvite(await regenerateInvite(me, roomId, { expiresInMinutes: expiry, maxMembers: max }));
    } catch {
      setError("새 링크를 만들지 못했어요. 잠시 뒤에 다시 시도해 주세요.");
    }
  };

  const link = invite ? `${window.location.origin}/join/${roomId}?invite=${invite.code}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("복사하지 못했어요. 주소를 눌러 직접 복사해 주세요.");
    }
  };

  return (
    <>
      <button className="btn keep" onClick={show} title="초대 링크를 보고 PL을 불러요">초대</button>
      {open && (
        <Dialog label="초대 링크" onClose={() => setOpen(false)} className="dialog">
          <strong>초대 링크</strong>
          {invite && (
            <>
              <input className="input" readOnly value={link} aria-label="초대 링크 주소" onFocus={(e) => e.currentTarget.select()} />
              <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
                최대 {invite.maxMembers}명 · {invite.expiresAt ? `${new Date(invite.expiresAt).toLocaleString("ko-KR")}까지` : "만료 없음"}
              </span>
              <div className="btn-row">
                <button className="btn primary" onClick={copy}>{copied ? "복사했어요" : "복사"}</button>
                <button className="btn ghost" onClick={() => setOpen(false)}>닫기</button>
              </div>
              <div className="menu-label" style={{ padding: "6px 0 0" }}>새 링크 만들기</div>
              <div className="btn-row">
                <label className="field" style={{ flex: 1 }}>
                  만료
                  <select className="input" aria-label="초대 만료" value={expiry ?? ""} onChange={(e) => setExpiry(e.target.value === "" ? null : Number(e.target.value))}>
                    {EXPIRY.map((x) => (
                      <option key={x.label} value={x.minutes ?? ""}>{x.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field" style={{ width: 90 }}>
                  최대 인원
                  <input className="input" type="number" min={2} max={12} aria-label="초대 최대 인원" value={max} onChange={(e) => setMax(Math.min(12, Math.max(2, Number(e.target.value) || 2)))} />
                </label>
              </div>
              <button className="btn" onClick={renew}>새 링크 만들기</button>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>새 링크를 만들면 이전 링크는 못 써요. 이미 들어온 사람은 그대로 들어올 수 있어요.</span>
            </>
          )}
          {error && <div className="err" role="alert">{error}</div>}
          {!invite && <button className="btn ghost" onClick={() => setOpen(false)}>닫기</button>}
        </Dialog>
      )}
    </>
  );
}
