"use client";
import { useEffect, useRef, useState } from "react";
import { EFFECT_LEVELS, LEVEL_LABEL_KO, type EffectLevel, type EffectSettings, type RollLogEntry } from "@coc-vtt/shared";

const DURATION_MS = 1800;

/**
 * 새 판정이 들어오면 단계에 맞는 화면 효과를 재생한다. 접속·재접속 때 이미 있던 굴림은 재생하지 않는다.
 * KP 설정(켜기·세기)과 내 설정(enabled)을 모두 통과해야 보인다.
 */
export function RollEffect({ rolls, ready, effects, enabled }: { rolls: RollLogEntry[]; ready: boolean; effects: EffectSettings; enabled: boolean }) {
  const lastId = useRef<string | null | undefined>(undefined);
  const [shown, setShown] = useState<{ id: string; level: EffectLevel; intensity: number } | null>(null);

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
    const level = last.outcome.level;
    if (!(EFFECT_LEVELS as readonly string[]).includes(level)) return;
    const setting = effects[level as EffectLevel];
    if (setting.enabled) setShown({ id: last.id, level: level as EffectLevel, intensity: setting.intensity });
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
    </div>
  );
}
