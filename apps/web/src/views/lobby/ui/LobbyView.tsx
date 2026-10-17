"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { RoomCard, listRooms, type RoomListItem } from "@/entities/room";
import { useIdentity, type Identity } from "@/entities/user";
import { LoginForm } from "@/features/auth";
import { CreateRoomForm } from "@/features/create-room";
import { JoinByLinkForm } from "@/features/join-by-link";
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
        <strong>{SERVICE_NAME}</strong>
        <div style={{ flex: 1 }} />
        <Link href="/characters" className="btn">내 캐릭터</Link>
        <span className="badge">{me.name}</span>
        <button className="btn" onClick={onLogout}>로그아웃</button>
      </header>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px", display: "grid", gap: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>내 룸</h1>
          <span style={{ color: "var(--muted)" }}>{rooms ? `룸 ${rooms.length}개` : ""}</span>
          <div style={{ flex: 1 }} />
          <CreateRoomForm me={me} onCreated={(id) => router.push(`/room/${id}`)} onError={setError} />
        </div>

        <JoinByLinkForm onJoin={(id, invite) => router.push(`/join/${id}?invite=${encodeURIComponent(invite)}`)} onError={setError} />

        {error && <div className="err" role="alert">{error}</div>}
        {rooms && rooms.length === 0 && (
          <div style={{ color: "var(--muted)", padding: "32px 0" }}>아직 룸이 없어요. 새 룸을 만들거나 초대 링크로 참가해 보세요.</div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {rooms?.map((r) => <RoomCard key={r.id} room={r} />)}
        </div>
      </main>
    </div>
  );
}
