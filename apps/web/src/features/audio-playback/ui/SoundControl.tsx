"use client";
import { useState } from "react";
import type { AudioPrefs } from "../model/useAudioPreference";

const SLIDERS: Array<{ key: "bgm" | "se" | "roll"; label: string }> = [
  { key: "bgm", label: "배경음" },
  { key: "se", label: "효과음" },
  { key: "roll", label: "굴림 효과음" },
];

/** 내 소리 설정. 채널별 볼륨과 전체 음소거. */
export function SoundControl({ prefs, onChange, unlocked, onUnlock, playing }: { prefs: AudioPrefs; onChange: (p: Partial<AudioPrefs>) => void; unlocked: boolean; onUnlock: () => void; playing: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative" }}>
      <button className="btn" aria-expanded={open} aria-pressed={!prefs.muted} data-testid="sound-toggle" onClick={() => setOpen((o) => !o)} title="내 소리 설정">
        소리 {prefs.muted ? "꺼짐" : playing ? "♪" : "켜짐"}
      </button>
      {open && (
        <div className="card" role="dialog" aria-label="소리 설정" data-testid="sound-panel" style={{ position: "absolute", right: 0, top: 40, width: 240, zIndex: 20, gap: 10 }}>
          {!unlocked && (
            <button className="btn primary" onClick={onUnlock}>소리 켜기</button>
          )}
          {SLIDERS.map((s) => (
            <label key={s.key} style={{ display: "grid", gap: 2, fontSize: 13 }}>
              {s.label} {prefs[s.key]}
              <input type="range" min={0} max={100} value={prefs[s.key]} aria-label={`${s.label} 볼륨`} onChange={(e) => onChange({ [s.key]: Number(e.target.value) })} style={{ accentColor: "#7c86f7" }} />
            </label>
          ))}
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={prefs.muted} onChange={(e) => onChange({ muted: e.target.checked })} style={{ accentColor: "#7c86f7" }} />
            전체 음소거
          </label>
        </div>
      )}
    </span>
  );
}
