"use client";
import { useEffect, useRef, useState } from "react";
import { EFFECT_LEVELS, LEVEL_LABEL_KO, type EffectLevel, type EffectSettings, type RollLogEntry } from "@coc-vtt/shared";

const DURATION_MS = 1800;
/** 이보다 오래된 굴림은 재접속 때 다시 받은 것이라 연출하지 않는다. 시계가 크게 어긋난 기기(5분 이상)는 이 검사를 건너뛴다. */
const STALE_MS = 8000;
const SKEW_MS = 5 * 60_000;

export function isStaleRoll(at: number, now: number): boolean {
  const age = now - at;
  return age > STALE_MS && age < SKEW_MS;
}

/**
 * 새 판정이 들어오면 단계에 맞는 화면 효과를 재생한다. 접속·재접속 때 이미 있던 굴림은 재생하지 않는다.
 * KP 설정(켜기·세기)과 내 설정(enabled)을 모두 통과해야 보인다.
 */
export function RollEffect({ rolls, ready, effects, enabled }: { rolls: RollLogEntry[]; ready: boolean; effects: EffectSettings; enabled: boolean }) {
  const lastId = useRef<string | null | undefined>(undefined);
  const [shown, setShown] = useState<{ id: string; level: EffectLevel; intensity: number; who: string; roll: string } | null>(null);

  const last = rolls.at(-1);
  useEffect(() => {
    if (!ready) return;
    if (lastId.current === undefined) {
      lastId.current = last?.id ?? null;
      return;
    }
    if (!last || last.id === lastId.current) return;
    lastId.current = last.id;
    if (!enabled || last.outcome.kind !== "cc" || !last.outcome.level) return;
    if (isStaleRoll(last.at, Date.now())) return;
    const level = last.outcome.level;
    // 난이도를 못 넘긴 판정은 실패다. 대실패만 빼고 성공 효과를 내지 않는다.
    if (last.outcome.success === false && level !== "fumble") return;
    if (!(EFFECT_LEVELS as readonly string[]).includes(level)) return;
    const setting = effects[level as EffectLevel];
    if (setting.enabled) {
      const target = last.outcome.target;
      setShown({
        id: last.id,
        level: level as EffectLevel,
        intensity: setting.intensity,
        who: `${last.userName}${last.label ? ` · ${last.label}` : ""}`,
        roll: `${last.outcome.percent.total}${target !== undefined ? ` / ${target}` : ""}`,
      });
    }
  }, [last, ready, effects, enabled]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), DURATION_MS);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown) return null;
  return (
    <div key={shown.id} className={`roll-fx fx-${shown.level} fx-i${shown.intensity}`} data-testid="roll-effect" data-level={shown.level} data-intensity={shown.intensity} aria-hidden="true">
      <span className="roll-fx-text">{LEVEL_LABEL_KO[shown.level]}</span>
      <span className="roll-fx-sub">{shown.who} · {shown.roll}</span>
    </div>
  );
}
