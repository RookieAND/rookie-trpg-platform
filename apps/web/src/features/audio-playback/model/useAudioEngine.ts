"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BgmState } from "@coc-vtt/shared";
import { audioUrl } from "@/shared/api";
import type { AudioPrefs } from "./useAudioPreference";

interface Input {
  bgm: BgmState | null;
  lastSe: { assetId: string; volume: number; n: number } | null;
  /** 서버 시계 − 내 시계(ms) */
  clockOffset: number;
  /** 가장 최근 굴림 id. 접속 직후의 기존 굴림에는 울리지 않는다. */
  lastRollId: string | null;
  ready: boolean;
  prefs: AudioPrefs;
}

const STOP_FADE_S = 0.6;

/**
 * 서버가 알려 준 배경음·효과음을 Web Audio로 재생한다.
 * 배경음은 서버가 시작한 시각(startedAt)에서 지금까지 흐른 만큼 건너뛴 자리부터 틀어 모두가 같은 소절을 듣는다.
 * 브라우저는 사용자가 한 번 누르기 전에는 소리를 막으므로, 첫 입력(또는 버튼)에서 풀어 준다.
 */
export function useAudioEngine({ bgm, lastSe, clockOffset, lastRollId, ready, prefs }: Input) {
  const ctxRef = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<string, Promise<AudioBuffer>>());
  const current = useRef<{ key: string; source: AudioBufferSourceNode; gain: GainNode } | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [playing, setPlaying] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const unlock = useCallback(() => {
    try {
      if (!ctxRef.current) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        ctxRef.current = new Ctor();
      }
      void ctxRef.current.resume();
      setUnlocked(true);
    } catch {
      /* 소리를 쓸 수 없는 환경이면 조용히 둔다 */
    }
  }, []);

  useEffect(() => {
    if (unlocked) return;
    const h = () => unlock();
    document.addEventListener("pointerdown", h, { once: true });
    document.addEventListener("keydown", h, { once: true });
    return () => {
      document.removeEventListener("pointerdown", h);
      document.removeEventListener("keydown", h);
    };
  }, [unlocked, unlock]);

  const load = useCallback((assetId: string) => {
    let p = buffers.current.get(assetId);
    if (!p) {
      const ctx = ctxRef.current!;
      p = fetch(audioUrl(assetId))
        .then((r) => {
          if (!r.ok) throw new Error("음원을 받지 못했어요.");
          return r.arrayBuffer();
        })
        .then((b) => ctx.decodeAudioData(b));
      p.catch(() => buffers.current.delete(assetId));
      buffers.current.set(assetId, p);
    }
    return p;
  }, []);

  const gainOf = (volume: number, channel: "bgm" | "se" | "roll") => {
    const p = prefsRef.current;
    return p.muted ? 0 : (volume / 100) * (p[channel] / 100);
  };

  const stopCurrent = useCallback((fadeS: number) => {
    const cur = current.current;
    const ctx = ctxRef.current;
    current.current = null;
    setPlaying(false);
    if (!cur || !ctx) return;
    const now = ctx.currentTime;
    cur.gain.gain.cancelScheduledValues(now);
    cur.gain.gain.setValueAtTime(cur.gain.gain.value, now);
    cur.gain.gain.linearRampToValueAtTime(0, now + fadeS);
    cur.source.stop(now + fadeS + 0.05);
  }, []);

  // 배경음: 곡이나 시작 시각이 바뀌면 새로 건다.
  const key = bgm ? `${bgm.assetId}@${bgm.startedAt}` : null;
  const bgmRef = useRef(bgm);
  bgmRef.current = bgm;
  const offsetRef = useRef(clockOffset);
  offsetRef.current = clockOffset;
  useEffect(() => {
    if (!unlocked || !ctxRef.current) return;
    if (!key) {
      stopCurrent(STOP_FADE_S);
      return;
    }
    if (current.current?.key === key) return;
    const want = bgmRef.current!;
    let cancelled = false;
    load(want.assetId)
      .then((buf) => {
        const ctx = ctxRef.current;
        if (cancelled || !ctx || bgmRef.current !== want) return;
        stopCurrent(Math.max(0.2, want.fadeMs / 1000));
        const source = ctx.createBufferSource();
        source.buffer = buf;
        source.loop = true;
        const gain = ctx.createGain();
        source.connect(gain).connect(ctx.destination);
        const elapsed = Math.max(0, (Date.now() + offsetRef.current - want.startedAt) / 1000);
        const target = gainOf(want.volume, "bgm");
        const fadeS = want.fadeMs / 1000;
        // 막 시작한 곡이면 서서히 키우고, 이미 한참 흐른 곡이면 바로 크게 튼다.
        if (fadeS > 0 && elapsed < fadeS) {
          gain.gain.setValueAtTime(0, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(target, ctx.currentTime + (fadeS - elapsed));
        } else {
          gain.gain.setValueAtTime(target, ctx.currentTime);
        }
        source.start(0, elapsed % buf.duration);
        current.current = { key: key!, source, gain };
        setPlaying(true);
      })
      .catch(() => {
        /* 받거나 풀지 못하면 조용히 둔다 */
      });
    return () => {
      cancelled = true;
    };
  }, [key, unlocked, load, stopCurrent]);

  // 볼륨이나 음소거가 바뀌면 흐르는 배경음에 바로 반영한다.
  useEffect(() => {
    const cur = current.current;
    const ctx = ctxRef.current;
    if (!cur || !ctx || !bgm) return;
    cur.gain.gain.cancelScheduledValues(ctx.currentTime);
    cur.gain.gain.setTargetAtTime(gainOf(bgm.volume, "bgm"), ctx.currentTime, 0.05);
  }, [bgm?.volume, prefs.bgm, prefs.muted, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // 효과음: 새 신호(n)가 올 때마다 한 번 울린다.
  const lastN = useRef<number | null>(null);
  useEffect(() => {
    if (!lastSe || lastSe.n === lastN.current) return;
    lastN.current = lastSe.n;
    const ctx = ctxRef.current;
    if (!unlocked || !ctx) return;
    load(lastSe.assetId)
      .then((buf) => {
        const source = ctx.createBufferSource();
        source.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = gainOf(lastSe.volume, "se");
        source.connect(gain).connect(ctx.destination);
        source.start();
      })
      .catch(() => {});
  }, [lastSe?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // 굴림 소리: 합성한 짧은 소리. 접속 직후의 지난 굴림에는 울리지 않는다.
  const lastRoll = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!ready) return;
    if (lastRoll.current === undefined) {
      lastRoll.current = lastRollId;
      return;
    }
    if (lastRollId === lastRoll.current) return;
    lastRoll.current = lastRollId;
    const ctx = ctxRef.current;
    if (!unlocked || !ctx) return;
    const vol = gainOf(100, "roll");
    if (vol <= 0) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const at = t0 + i * 0.07 + Math.random() * 0.02;
      osc.type = "triangle";
      osc.frequency.setValueAtTime(700 - i * 90 + Math.random() * 60, at);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.35 * vol, at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
      osc.connect(g).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.08);
    }
  }, [lastRollId, ready, unlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      try {
        current.current?.source.stop();
        void ctxRef.current?.close();
      } catch {
        /* 이미 닫혔다 */
      }
    },
    [],
  );

  return { unlocked, unlock, playing };
}
