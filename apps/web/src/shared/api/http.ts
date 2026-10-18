import { API_URL } from "../config";

/** 요청하는 사람. 지금은 개발용 헤더로 보내고, Discord 로그인이 붙으면 토큰으로 바꾼다. */
export interface Caller {
  userId: string;
  name: string;
  /** 디스코드 로그인 토큰. 있으면 개발용 헤더 대신 이것으로 인증한다. */
  token?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** 서버가 에러와 함께 보낸 내용(충돌 때 최신 데이터 등) */
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export function authHeaders(me: Caller): Record<string, string> {
  return me.token
    ? { authorization: `Bearer ${me.token}` }
    : {
        // HTTP 헤더에는 한글을 바로 실을 수 없어 퍼센트 인코딩해서 보낸다.
        "x-dev-user": encodeURIComponent(me.userId),
        "x-dev-name": encodeURIComponent(me.name),
      };
}

export async function http<T>(me: Caller, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", ...authHeaders(me) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.message ?? "요청에 실패했어요.", json);
  return json as T;
}

/**
 * 본문을 글 그대로(JSON 글자) 보내고 JSON을 받는다. 시나리오·백업 파일처럼 커서 웹소켓으로 못 보내는 것에 쓴다.
 * 오류 본문의 errors(위치별 문제 목록)는 ApiError.body로 받는다.
 */
export async function httpText<T>(me: Caller, method: string, path: string, text: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method, headers: { "content-type": "text/plain", ...authHeaders(me) }, body: text });
  const raw = await res.text();
  let json: { message?: string } | null = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    /* 서버가 아닌 곳(프록시)의 오류 글 */
  }
  if (!res.ok) throw new ApiError(res.status, json?.message ?? "요청에 실패했어요.", json);
  return json as T;
}

/** 파일로 받을 글(JSON 글자)과 서버가 머리글로 알려 준 안내를 돌려준다. */
export async function httpDownload(me: Caller, path: string): Promise<{ text: string; notes: string[] }> {
  const res = await fetch(`${API_URL}${path}`, { headers: authHeaders(me) });
  const text = await res.text();
  if (!res.ok) {
    let message = "요청에 실패했어요.";
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {
      /* 글 그대로 */
    }
    throw new ApiError(res.status, message);
  }
  const header = res.headers.get("x-export-notes");
  const notes = header ? decodeURIComponent(header).split("|").filter(Boolean) : [];
  return { text, notes };
}
