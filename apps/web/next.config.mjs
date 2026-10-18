// 운영 배포(Vercel)에서는 NEXT_PUBLIC_* 값이 비어 있으면 방문자의 localhost로 API를 부르는 사이트가 만들어진다.
// 그런 빌드는 실패시킨다. 로컬에서 `next build`만 해 보는 경우에는 경고만 한다. (STRICT_PUBLIC_ENV=1이면 어디서든 실패)
const strict = process.env.VERCEL_ENV === "production" || process.env.STRICT_PUBLIC_ENV === "1";
const missing = ["NEXT_PUBLIC_API_URL"].filter((k) => !process.env[k]?.trim());
if (missing.length && process.env.NODE_ENV === "production") {
  const msg = `${missing.join(", ")}가 비어 있어요. 이대로 빌드하면 방문자 브라우저가 자기 컴퓨터(localhost)의 API를 부르게 돼요. Vercel 프로젝트 환경변수를 확인하세요. (docs/deploy-env.md)`;
  if (strict) throw new Error(msg);
  console.warn(`[경고] ${msg}`);
}
if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn("[경고] NEXT_PUBLIC_SUPABASE_ANON_KEY가 없어요. 로그인은 되지만 토큰이 만료되면 자동 갱신이 안 돼 다시 로그인해야 해요.");
}

/**
 * 보안 헤더.
 *  - frame-ancestors 'none' / X-Frame-Options: 다른 사이트가 이 서비스를 iframe에 넣지 못하게 한다(클릭재킹 방지). 임베드할 곳이 없다.
 *  - 전체 CSP(script-src 등)는 걸지 않았다. Next가 넣는 인라인 스크립트에 nonce를 달아야 하고, 지금은 그 이득보다 깨질 위험이 커서
 *    base-uri·form-action·object-src처럼 스크립트 실행에 영향 없는 지시어만 둔다.
 *  - HSTS: https로만 접속하게 한다. Vercel 기본 도메인은 이미 붙여 주지만 커스텀 도메인에서도 같게 한다.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@coc-vtt/shared"],
  // 개발 서버의 오른쪽 아래 표시가 보드 아래 도구 버튼을 가려 e2e 클릭을 막는 일이 있어 끈다.
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default nextConfig;
