"use client";
import { useCallback, useEffect, useState } from "react";
import { SUPABASE_URL } from "@/shared/config";
import { clearIdentity, loadIdentity, loadStoredSession, saveIdentity, type Identity } from "./identity";
import { refreshStoredSession } from "./session";

/** undefined: 아직 확인 전, null: 로그인 안 됨 */
export function useIdentity() {
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined);
  useEffect(() => {
    const current = loadIdentity();
    if (current) return setIdentity(current);
    // 디스코드 로그인이 만료됐어도 갱신 토큰이 있으면 조용히 새로 받는다.
    if (SUPABASE_URL && loadStoredSession()?.refreshToken) {
      let alive = true;
      refreshStoredSession().then((r) => alive && setIdentity(r.status === "ok" ? r.identity : null));
      return () => void (alive = false);
    }
    setIdentity(null);
  }, []);
  const login = useCallback((name: string) => setIdentity(saveIdentity(name)), []);
  const logout = useCallback(() => (clearIdentity(), setIdentity(null)), []);
  return { identity, login, logout };
}
