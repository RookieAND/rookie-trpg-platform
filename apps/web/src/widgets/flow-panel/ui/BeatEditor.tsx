"use client";
import { useState } from "react";
import { BEAT_KINDS, BGM_STOP, BEAT_KIND_LABEL_KO, MAX_BEAT_HANDOUTS, type AudioTrack, type Beat, type BeatKind, type Handout, type Scene } from "@coc-vtt/shared";

export interface BeatDraft {
  id?: string;
  name: string;
  kind: BeatKind;
  memo: string;
  sceneId?: string;
  bgmTrackId?: string;
  handoutIds: string[];
  sanReward?: string;
}

/** 비트 하나를 쓴다: 이름, 종류, 들어갈 때 열 장면과 핸드아웃, GM 메모. */
export function BeatEditor({ initial, scenes, handouts, tracks, onSave, onCancel }: { initial?: Beat; scenes: Scene[]; handouts: Handout[]; tracks: AudioTrack[]; onSave: (d: BeatDraft) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<BeatKind>(initial?.kind ?? "progress");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [sceneId, setSceneId] = useState(initial?.sceneId ?? "");
  const [bgmTrackId, setBgmTrackId] = useState(initial?.bgmTrackId ?? "");
  const [picked, setPicked] = useState<string[]>(initial?.handoutIds ?? []);
  const [san, setSan] = useState(initial?.sanReward ?? "");
  const valid = name.trim().length > 0;

  return (
    <div style={{ display: "grid", gap: 10 }} data-testid="beat-editor">
      <input className="input" aria-label="비트 이름" placeholder="비트 이름" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <select className="input" aria-label="비트 종류" value={kind} onChange={(e) => setKind(e.target.value as BeatKind)}>
        {BEAT_KINDS.map((k) => (
          <option key={k} value={k}>{BEAT_KIND_LABEL_KO[k]} 비트</option>
        ))}
      </select>
      <select className="input" aria-label="들어갈 때 열 장면" value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
        <option value="">장면은 그대로</option>
        {scenes.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <select className="input" aria-label="들어갈 때 틀 배경음" value={bgmTrackId} onChange={(e) => setBgmTrackId(e.target.value)}>
        <option value="">배경음은 그대로</option>
        <option value={BGM_STOP}>■ 음악 정지</option>
        {tracks.filter((t) => t.kind === "bgm").map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      {handouts.length > 0 && (
        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8, display: "grid", gap: 4 }}>
          <legend style={{ fontSize: 12, color: "var(--muted)" }}>들어갈 때 펼칠 핸드아웃 (공개된 것만)</legend>
          {handouts.map((h) => (
            <label key={h.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={picked.includes(h.id)}
                disabled={!picked.includes(h.id) && picked.length >= MAX_BEAT_HANDOUTS}
                onChange={(e) => setPicked(e.target.checked ? [...picked, h.id] : picked.filter((x) => x !== h.id))}
                style={{ accentColor: "#7c86f7" }}
              />
              {h.title}
              {h.visibleTo === "gm" && <span style={{ color: "var(--muted)", fontSize: 12 }}>(초안이라 건너뜀)</span>}
            </label>
          ))}
        </fieldset>
      )}
      {kind === "ending" && <input className="input mono" aria-label="엔딩 SAN 보상" placeholder="SAN 보상 (예: 1d6+1d4)" maxLength={64} value={san} onChange={(e) => setSan(e.target.value)} />}
      <textarea className="input" style={{ height: 72, padding: 12 }} aria-label="GM 메모" placeholder="GM 메모 (참가자에게 안 보여요)" maxLength={1000} value={memo} onChange={(e) => setMemo(e.target.value)} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>취소</button>
        <button
          className="btn primary"
          disabled={!valid}
          onClick={() => onSave({ ...(initial ? { id: initial.id } : {}), name: name.trim(), kind, memo, ...(sceneId ? { sceneId } : {}), ...(bgmTrackId ? { bgmTrackId } : {}), handoutIds: picked, ...(kind === "ending" && san.trim() ? { sanReward: san.trim() } : {}) })}
        >
          저장
        </button>
      </div>
    </div>
  );
}
