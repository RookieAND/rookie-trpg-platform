"use client";
import { useSyncExternalStore } from "react";

/** CSS 미디어 쿼리가 지금 맞는지. 서버·첫 그리기에서는 false. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const m = window.matchMedia(query);
      m.addEventListener("change", notify);
      return () => m.removeEventListener("change", notify);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** 휴대폰 폭. CSS의 `.room.phone` 규칙과 같은 기준이다. */
export const PHONE_QUERY = "(max-width: 640px)";
export const usePhone = () => useMediaQuery(PHONE_QUERY);
