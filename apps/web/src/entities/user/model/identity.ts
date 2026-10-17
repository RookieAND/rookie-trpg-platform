"use client";
import { useCallback, useEffect, useState } from "react";

export interface Identity {
  userId: string;
  name: string;
  /** 디스코드 로그인 때만 있다. 서버가 검증한다. */
  token?: string;
  /** 토큰 만료 시각(초). */
  expiresAt?: number;
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

/** undefined: 아직 확인 전, null: 로그인 안 됨 */
export function useIdentity() {
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined);
  useEffect(() => setIdentity(loadIdentity()), []);
  const login = useCallback((name: string) => setIdentity(saveIdentity(name)), []);
  const logout = useCallback(() => (clearIdentity(), setIdentity(null)), []);
  return { identity, login, logout };
}
