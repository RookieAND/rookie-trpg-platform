import Link from "next/link";
import { ROLE_LABEL, SESSION_STATUS_LABEL, type RoomListItem } from "../model/types";

/** 로비의 룸 카드 */
export function RoomCard({ room }: { room: RoomListItem }) {
  const action = room.sessionStatus === "PAUSED" && room.role === "kp" ? "이어하기" : room.sessionStatus === "ACTIVE" ? "입장" : "룸 열기";
  return (
    <article data-testid="room-card" className="card">
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className={`badge ${room.role === "kp" ? "kp" : ""}`}>{room.role ? ROLE_LABEL[room.role] : "관전"}</span>
        <span className={`badge ${room.sessionStatus === "PAUSED" ? "paused" : ""}`}>{SESSION_STATUS_LABEL[room.sessionStatus]}</span>
      </div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{room.name}</div>
        <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
          {room.sessionNumber > 0 ? `세션 ${room.sessionNumber}` : "세션 시작 전"} · 접속 {room.online}명
        </div>
      </div>
      <Link className="btn primary" href={`/room/${room.id}`} style={{ textAlign: "center", lineHeight: "34px", textDecoration: "none" }}>
        {action}
      </Link>
    </article>
  );
}
