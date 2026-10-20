"use client";
import { Sparkles, WandSparkles } from "lucide-react";

export function EffectToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button className="btn" onClick={onToggle} title="판정 화면 효과를 내 화면에서만 켜거나 꺼요">
      {enabled ? <Sparkles aria-hidden /> : <WandSparkles aria-hidden />}내 화면 효과 {enabled ? "끄기" : "켜기"}
    </button>
  );
}
