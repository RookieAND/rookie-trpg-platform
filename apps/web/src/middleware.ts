import { NextResponse, type NextRequest } from "next/server";

/**
 * 스크립트 CSP(`script-src 'self' 'nonce-…'`).
 * 요청마다 nonce를 만들어 Next가 자기 인라인 스크립트에 붙이게 한다.
 * 기본은 Report-Only(브라우저 콘솔에만 위반을 알림)라 화면이 깨질 일이 없다.
 * 한 달쯤 위반이 없으면 CSP_ENFORCE=1로 차단 모드로 바꾼다. (docs/deploy-env.md)
 */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const enforce = process.env.CSP_ENFORCE === "1";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss: ws://localhost:* http://localhost:* ws://127.0.0.1:* http://127.0.0.1:*",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  const header = enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set(header, csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(header, csp);
  return res;
}

export const config = {
  matcher: [{ source: "/((?!api|_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};
