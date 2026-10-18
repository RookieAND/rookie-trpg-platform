"use client";
import { useCallback, useEffect, useState } from "react";

const KEY = "coc-vtt.effects";

/** 판정 효과를 내 화면에서 볼지. 참가자 개인 설정이라 이 브라우저에만 저장한다. */
export function useEffectPreference() {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "off") setEnabled(false);
      // 저장한 선택이 없고 기기가 '움직임 줄이기'면 기본을 끈다.
      else if (saved === null && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setEnabled(false);
    } catch {
      /* 저장소를 못 쓰면 기본값(켜짐)을 쓴다 */
    }
  }, []);
  const toggle = useCallback(() => {
    setEnabled((cur) => {
      try {
        localStorage.setItem(KEY, cur ? "off" : "on");
      } catch {
        /* 이번 탭에서만 유지된다 */
      }
      return !cur;
    });
  }, []);
  return { enabled, toggle };
}
