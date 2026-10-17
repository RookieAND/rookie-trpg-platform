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
  if (!res.ok) throw new ApiError(res.status, json?.message ?? "요청에 실패했어요.");
  return json as T;
}
