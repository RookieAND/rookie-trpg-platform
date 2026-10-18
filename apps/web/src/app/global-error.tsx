"use client";
import { useEffect } from "react";

/**
 * 맨 바깥 레이아웃까지 깨졌을 때의 마지막 안내. 이때는 전역 CSS도 못 불러왔을 수 있어서 스타일을 이 안에 직접 적는다.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const box = { maxWidth: 360, margin: "120px auto", padding: "0 16px", display: "grid", gap: 12 } as const;
  const btn = { height: 32, padding: "0 14px", borderRadius: 6, border: "1px solid rgba(255,255,255,.14)", background: "#5e6ad2", color: "#fff", font: "inherit", cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center" } as const;
  return (
    <html lang="ko">
      <body style={{ margin: 0, background: "#08090a", color: "#e8e9ec", fontFamily: "system-ui, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif", fontSize: 14, lineHeight: 1.5 }}>
        <main style={box} role="alert" data-testid="error-panel">
          <strong style={{ fontSize: 16 }}>문제가 생겼어요</strong>
          <span>새로고침해 보세요. 계속 안 되면 잠시 뒤에 다시 들어와 주세요.</span>
          <div style={{ display: "flex", gap: 8 }}>
            {/* 화면 전체가 깨진 상태라 reset보다 새로 불러오는 편이 확실하다. */}
            <button style={btn} onClick={() => window.location.reload()} data-testid="error-retry">다시 시도</button>
            <a style={{ ...btn, background: "transparent" }} href="/" data-testid="error-home">로비로</a>
          </div>
          {error.digest && <span style={{ color: "#84878f", fontSize: 12 }}>오류 번호 {error.digest}</span>}
        </main>
      </body>
    </html>
  );
}
