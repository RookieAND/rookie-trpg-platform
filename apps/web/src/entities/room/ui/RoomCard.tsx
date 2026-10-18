"use client";
import { useState } from "react";
import Link from "next/link";
import { ROLE_LABEL, SESSION_STATUS_LABEL, type RoomListItem } from "../model/types";

/** 로비의 룸 카드. 룸을 만든 사람(GM)은 두 번 눌러 룸을 지울 수 있다. */
export function RoomCard({ room, onRemove }: { room: RoomListItem; onRemove?: (id: string) => Promise<void> | void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const action = room.sessionStatus === "PAUSED" && room.role === "kp" ? "이어하기" : room.sessionStatus === "ACTIVE" ? "입장" : "룸 열기";
  const canRemove = room.role === "kp" && onRemove;

  const remove = async () => {
    setBusy(true);
    try {
      await onRemove?.(room.id);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <article data-testid="room-card" className="card link room-card">
      <div className="room-main">
        <h3>{room.name}</h3>
        <div className="room-meta">
          {room.sessionNumber > 0 ? `세션 ${room.sessionNumber}` : "세션 시작 전"} · 접속 {room.online}명
        </div>
      </div>
      <div className="room-tags">
        <span className={`badge ${room.role === "kp" ? "kp" : ""}`}>{room.role ? ROLE_LABEL[room.role] : "관전"}</span>
        <span className={`badge status ${room.sessionStatus === "ACTIVE" ? "live" : ""} ${room.sessionStatus === "PAUSED" ? "paused" : ""}`}>{SESSION_STATUS_LABEL[room.sessionStatus]}</span>
      </div>
      {confirming ? (
        <div className="confirm room-confirm" role="alertdialog" aria-label="룸 삭제 확인">
          <span>룸과 안의 모든 기록이 사라져요. 되돌릴 수 없어요.</span>
          <div className="btn-row">
            <button className="btn sm danger" disabled={busy} onClick={remove}>{busy ? "지우는 중…" : "지우기"}</button>
            <button className="btn sm ghost" disabled={busy} onClick={() => setConfirming(false)}>취소</button>
          </div>
        </div>
      ) : (
        <div className="room-actions">
          {canRemove && <button className="btn sm ghost" aria-label={`${room.name} 룸 삭제`} onClick={() => setConfirming(true)}>삭제</button>}
          <Link className="btn sm" href={`/room/${room.id}`}>{action}</Link>
        </div>
      )}
    </article>
  );
}
