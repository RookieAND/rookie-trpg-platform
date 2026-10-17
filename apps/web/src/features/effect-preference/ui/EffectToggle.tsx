"use client";

export function EffectToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button className="btn" aria-pressed={enabled} onClick={onToggle} title="판정 화면 효과를 내 화면에서 켜거나 끕니다">
      효과 {enabled ? "켜짐" : "꺼짐"}
    </button>
  );
}
