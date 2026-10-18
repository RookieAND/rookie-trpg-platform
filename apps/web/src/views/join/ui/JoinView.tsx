"use client";
import { useRouter } from "next/navigation";
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
  const [info, setInfo] = useState<{ name: string; online: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle(info ? roomTitle(info.name, SERVICE_NAME) : null);

  useEffect(() => {
    if (!identity) return;
    getRoom(identity, roomId, invite)
      .then((r) => setInfo({ name: r.name, online: r.online }))
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
    <main style={{ maxWidth: 360, margin: "120px auto", display: "grid", gap: 12, padding: "0 16px" }}>
      {error ? (
        <div className="err" role="alert">{error}</div>
      ) : info ? (
        <>
          <h1 style={{ margin: 0, fontSize: 22 }}>{info.name}</h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>지금 {info.online}명이 접속해 있어요.</p>
          <button className="btn primary" onClick={() => router.push(`/room/${roomId}?invite=${encodeURIComponent(invite)}`)}>PL로 입장</button>
        </>
      ) : (
        <p style={{ color: "var(--muted)" }}>확인하는 중이에요…</p>
      )}
    </main>
  );
}
