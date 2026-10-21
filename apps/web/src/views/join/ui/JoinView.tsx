"use client";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, LogIn, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { getRoom } from "@/entities/room";
import { useIdentity } from "@/entities/user";
import { LoginForm } from "@/features/auth";
import { ApiError } from "@/shared/api";
import { SERVICE_NAME } from "@/shared/config";
import { roomTitle, useDocumentTitle } from "@/shared/lib";

/** 초대 링크로 들어오는 첫 화면. 이름을 정하고, 룸을 확인한 뒤 입장한다. */
export function JoinView({ roomId, invite }: { roomId: string; invite: string }) {
  const router = useRouter();
  const { identity, login } = useIdentity();
  const [info, setInfo] = useState<{ name: string; online: number; spectator: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(info ? roomTitle(info.name, SERVICE_NAME) : null);

  useEffect(() => {
    if (!identity) return;
    getRoom(identity, roomId, invite)
      .then((r) => setInfo({ name: r.name, online: r.online, spectator: r.joinAs === "spectator" }))
      .catch((e) =>
        setError(
          e instanceof ApiError && e.status === 404
            ? "룸을 찾을 수 없어요. 링크를 다시 확인해 주세요."
            : e instanceof ApiError && e.status === 403
              ? "이 초대 링크는 사용할 수 없어요. 만료됐거나 인원이 가득 찼을 수 있어요. GM에게 새 링크를 받아 주세요."
              : "서버에 연결하지 못했어요.",
        ),
      );
  }, [identity, roomId, invite]);

  if (identity === undefined) return null;
  if (identity === null) return <LoginForm title="룸에 초대받았어요" submitLabel="계속하기" onLogin={login} />;
  return (
    <main className="login join-card">
      {error ? (
        <>
          <h1 className="brand" style={{ margin: 0, fontSize: 18 }}>초대 링크를 열 수 없어요</h1>
          <div className="err" role="alert">{error}</div>
          <button className="btn lg" onClick={() => router.push("/")}><ArrowLeft aria-hidden />로비로 돌아가기</button>
        </>
      ) : info ? (
        <>
          <span className="join-cap">{info.spectator ? "관전 초대" : "PL 초대"}</span>
          <h1 className="join-name">{info.name}</h1>
          <p className="join-meta"><Users aria-hidden />지금 {info.online}명이 접속해 있어요.</p>
          {info.spectator && <p style={{ margin: 0 }} data-testid="join-spectator-note">관전 링크예요. 보드와 공개된 굴림·핸드아웃을 보기만 하고, 아무것도 바꿀 수 없어요.</p>}
          <button className="btn primary lg" data-testid="join-enter" onClick={() => router.push(`/room/${roomId}?invite=${encodeURIComponent(invite)}`)}>{info.spectator ? <Eye aria-hidden /> : <LogIn aria-hidden />}{info.spectator ? "관전으로 입장" : "PL로 입장"}</button>
          <button className="btn ghost" onClick={() => router.push("/")}>로비로</button>
        </>
      ) : (
        <p style={{ color: "var(--muted)", margin: 0 }}>확인하는 중이에요…</p>
      )}
    </main>
  );
}
