"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { consumeReturnTo, saveSession, sessionFromCallbackHash } from "@/entities/user";

/** 디스코드 로그인이 끝나고 돌아오는 곳. 세션을 저장하고 원래 가려던 곳으로 보낸다. */
export function AuthCallbackView() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const session = sessionFromCallbackHash(window.location.hash);
    if (!session) return setFailed(true);
    saveSession(session);
    // 주소창에 남은 토큰을 지운 뒤 이동한다.
    window.history.replaceState(null, "", window.location.pathname);
    router.replace(consumeReturnTo());
  }, [router]);
  return (
    <main style={{ maxWidth: 360, margin: "120px auto", padding: "0 16px" }}>
      {failed ? (
        <>
          <p>로그인하지 못했어요.</p>
          <a className="btn" href="/">처음으로</a>
        </>
      ) : (
        <p style={{ color: "var(--muted)" }}>로그인하는 중…</p>
      )}
    </main>
  );
}
