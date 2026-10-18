/** 끝의 `/`를 떼서 `${base}/rooms`처럼 이어 붙여도 `//`가 생기지 않게 한다. */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * 실시간(ws) 주소를 정한다.
 *  - NEXT_PUBLIC_REALTIME_URL이 있으면 그것을 쓴다(http(s)로 적었으면 ws(s)로 바꾼다).
 *  - 없으면 API 주소에서 만든다: https://api.example.com → wss://api.example.com/ws
 * API와 웹소켓은 한 서버의 한 포트라서 보통 API 주소만 정하면 된다.
 */
export function deriveRealtimeUrl(apiUrl: string, explicit?: string): string {
  const toWs = (u: string) => u.replace(/^http(s?):\/\//i, (_, s: string) => `ws${s}://`);
  const given = explicit?.trim();
  if (given) return toWs(given);
  return `${toWs(normalizeBaseUrl(apiUrl))}/ws`;
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

/**
 * https 페이지에서 `ws://` 주소로는 브라우저가 연결을 막는다(혼합 콘텐츠). 로컬이 아닌 호스트면 wss로 올려서 쓴다.
 * 페이지가 http이거나 로컬 개발이면 그대로 둔다.
 */
export function secureRealtimeUrl(url: string, pageProtocol: string | undefined): string {
  if (pageProtocol !== "https:" || !/^ws:\/\//i.test(url)) return url;
  try {
    return LOCAL_HOST.test(new URL(url).hostname) ? url : url.replace(/^ws:/i, "wss:");
  } catch {
    return url;
  }
}
