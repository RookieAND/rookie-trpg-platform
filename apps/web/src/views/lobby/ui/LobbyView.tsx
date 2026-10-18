"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { RoomCard, deleteRoom, listRooms, type RoomListItem } from "@/entities/room";
import { useIdentity, type Identity } from "@/entities/user";
import { LoginForm } from "@/features/auth";
import { CreateRoomForm } from "@/features/create-room";
import { JoinByLinkForm } from "@/features/join-by-link";
import { ApiError } from "@/shared/api";
import { SERVICE_NAME } from "@/shared/config";

export function LobbyView() {
  const { identity, login, logout } = useIdentity();
  if (identity === undefined) return null;
  if (identity === null) {
    return <LoginForm title={SERVICE_NAME} description="개발용 로그인이에요. 이름만 정하면 시작할 수 있어요. Discord 로그인은 곧 연결돼요." submitLabel="시작하기" onLogin={login} />;
  }
  return <Lobby me={identity} onLogout={logout} />;
}

function Lobby({ me, onLogout }: { me: Identity; onLogout: () => void }) {
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listRooms(me)
      .then((r) => (setRooms(r), setError(null)))
      .catch(() => setError("서버에 연결하지 못했어요. 잠시 뒤에 다시 시도해 주세요."));
  }, [me]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div style={{ minHeight: "100vh" }}>
      <header className="topbar">
        <span className="brand">{SERVICE_NAME}</span>
        <div style={{ flex: 1 }} />
        <Link href="/characters" className="btn ghost">내 캐릭터</Link>
        <span className="sep" />
        <span className="badge">{me.name}</span>
        <button className="btn ghost" onClick={onLogout}>로그아웃</button>
      </header>
      <main className="page">
        <div className="page-head">
          <h1>내 룸</h1>
          <span className="count">{rooms ? `${rooms.length}개` : ""}</span>
          <div style={{ flex: 1 }} />
          <CreateRoomForm me={me} onCreated={(id) => router.push(`/room/${id}`)} onError={setError} />
        </div>

        <JoinByLinkForm onJoin={(id, invite) => router.push(`/join/${id}?invite=${encodeURIComponent(invite)}`)} onError={setError} />

        {error && <div className="err" role="alert">{error}</div>}
        {rooms && rooms.length === 0 && (
          <div className="empty">아직 룸이 없어요. 새 룸을 만들거나 초대 링크로 참가해 보세요.</div>
        )}

        <div className="room-grid">
          {rooms?.map((r) => <RoomCard
              key={r.id}
              room={r}
              onRemove={async (id) => {
                try {
                  await deleteRoom(me, id);
                  setRooms((cur) => cur?.filter((x) => x.id !== id) ?? null);
                  setError(null);
                } catch (e) {
                  setError(e instanceof ApiError ? e.message : "룸을 지우지 못했어요.");
                }
              }}
            />)}
        </div>
      </main>
    </div>
  );
}
