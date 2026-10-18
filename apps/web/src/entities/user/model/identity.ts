"use client";

export interface Identity {
  userId: string;
  name: string;
  /** 디스코드 로그인 때만 있다. 서버가 검증한다. */
  token?: string;
  /** 토큰 만료 시각(초). */
  expiresAt?: number;
  /** 액세스 토큰이 만료됐을 때 새로 받는 데 쓰는 갱신 토큰. 디스코드 로그인 때만 있다. */
  refreshToken?: string;
}

const KEY = "coc-vtt.identity";

/** 개발용 신원. Discord 로그인이 붙으면 세션에서 가져온 값으로 대체한다. */
export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Identity;
    if (!v.userId || !v.name) return null;
    if (v.expiresAt && v.expiresAt <= Date.now() / 1000) return null; // 만료된 로그인은 없는 것으로 본다.
    return v;
  } catch {
    return null;
  }
}

/** 만료 여부와 상관없이 저장된 로그인 세션을 읽는다(갱신용). 개발용 로그인은 null. */
export function loadStoredSession(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Identity;
    return v.userId && v.name && v.token ? v : null;
  } catch {
    return null;
  }
}

export function saveIdentity(name: string): Identity {
  const trimmed = name.trim().slice(0, 40);
  const identity = { userId: trimmed.toLowerCase().replace(/\s+/g, "-"), name: trimmed };
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    /* 저장이 막힌 환경에서는 이번 탭에서만 유지된다 */
  }
  return identity;
}

/** 디스코드 로그인으로 받은 세션을 저장한다. */
export function saveSession(session: Identity): Identity {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* 저장이 막힌 환경에서는 이번 탭에서만 유지된다 */
  }
  return session;
}

export function clearIdentity() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
