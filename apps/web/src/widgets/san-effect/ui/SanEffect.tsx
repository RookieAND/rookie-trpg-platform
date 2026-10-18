"use client";
import { useEffect, useRef, useState } from "react";
import { isStaleEvent } from "@/shared/lib";
import type { RollLogEntry } from "@coc-vtt/shared";
import { SAN_EFFECT_TEXT, sanEffectKind, type SanEffectKind } from "../model/san";

const DURATION_MS = 2800;

/**
 * SAN 체크에서 큰 손실이나 광기가 나오면 화면 가장자리를 천천히 어둡게 한다. 번쩍임·흔들림 없이 한 번 서서히 나타났다 사라진다.
 * 내 설정(enabled)을 따르고, 움직임 줄이기에서는 서서히 변하는 대신 잠깐 고정해 보여 준다. 접속·재접속 때 이미 있던 굴림은 건너뛴다.
 */
export function SanEffect({ rolls, ready, enabled }: { rolls: RollLogEntry[]; ready: boolean; enabled: boolean }) {
  const lastId = useRef<string | null | undefined>(undefined);
  const [shown, setShown] = useState<{ id: string; kind: SanEffectKind } | null>(null);
  const last = rolls.at(-1);

  useEffect(() => {
    if (!ready) return;
    if (lastId.current === undefined) {
      lastId.current = last?.id ?? null;
      return;
    }
    if (!last || last.id === lastId.current) return;
    lastId.current = last.id;
    if (!enabled || isStaleEvent(last.at, Date.now())) return;
    const kind = sanEffectKind(last.outcome);
    if (kind) setShown({ id: last.id, kind });
  }, [last, ready, enabled]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), DURATION_MS);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown) return null;
  return (
    <div key={shown.id} className={`san-fx san-${shown.kind}`} data-testid="san-effect" data-kind={shown.kind} aria-hidden="true">
      <span className="san-fx-text">{SAN_EFFECT_TEXT[shown.kind]}</span>
    </div>
  );
}
