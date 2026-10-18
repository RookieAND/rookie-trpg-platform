"use client";
import Link from "next/link";

/**
 * 오류·없는 페이지 안내. 흰 화면 대신 무슨 일인지와 다음 행동(다시 시도, 로비로)을 보여 준다.
 * 룸 안에서도 쓰므로 스타일은 기존 로그인 화면(.login, .err, .btn)을 따른다.
 */
export function ErrorPanel({
  title,
  description,
  onRetry,
  retryLabel = "다시 시도",
  digest,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Next가 서버 오류에 붙여 주는 번호. 문의할 때 알려 주면 로그에서 찾을 수 있다. */
  digest?: string;
}) {
  return (
    <main className="login" data-testid="error-panel">
      <div className="err" role="alert">
        <strong style={{ display: "block", marginBottom: 4 }}>{title}</strong>
        {description}
      </div>
      <div className="btn-row">
        {onRetry && (
          <button className="btn primary" onClick={onRetry} data-testid="error-retry">
            {retryLabel}
          </button>
        )}
        <Link className="btn" href="/" data-testid="error-home">
          로비로
        </Link>
      </div>
      {digest && <p style={{ margin: 0, color: "var(--muted)", fontSize: 11.5 }}>오류 번호 {digest}</p>}
    </main>
  );
}
