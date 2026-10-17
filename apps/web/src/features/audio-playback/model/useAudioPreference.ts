"use client";
import { useCallback, useEffect, useState } from "react";

const KEY = "coc-vtt.audio";

export interface AudioPrefs {
  /** 0~100 */
  bgm: number;
  se: number;
  roll: number;
  muted: boolean;
}

const DEFAULTS: AudioPrefs = { bgm: 70, se: 80, roll: 60, muted: false };
const clamp = (n: unknown, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : d);

/** 배경음·효과음·굴림 소리 볼륨과 음소거. 참가자 개인 설정이라 이 브라우저에만 저장한다. */
export function useAudioPreference() {
  const [prefs, setPrefs] = useState<AudioPrefs>(DEFAULTS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<AudioPrefs>;
      setPrefs({ bgm: clamp(p.bgm, DEFAULTS.bgm), se: clamp(p.se, DEFAULTS.se), roll: clamp(p.roll, DEFAULTS.roll), muted: p.muted === true });
    } catch {
      /* 저장소를 못 쓰거나 값이 깨졌으면 기본값을 쓴다 */
    }
  }, []);
  const update = useCallback((patch: Partial<AudioPrefs>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* 이번 탭에서만 유지된다 */
      }
      return next;
    });
  }, []);
  return { prefs, update };
}
