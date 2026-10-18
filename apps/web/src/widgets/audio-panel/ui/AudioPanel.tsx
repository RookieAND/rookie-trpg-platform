"use client";
import { useRef, useState } from "react";
import { MAX_AUDIO_TRACKS, type AudioKind, type AudioTrack, type BgmState, type ClientCommand } from "@coc-vtt/shared";
import { uploadAudio, type Caller } from "@/shared/api";

const KIND_LABEL: Record<AudioKind, string> = { bgm: "배경음", se: "효과음" };
const FADES = [0, 1000, 3000];

/** KP가 음원을 올리고 틀고 멈추는 곳. */
export function AudioPanel({ me, library, bgm, enabled, send }: { me: Caller; library: AudioTrack[]; bgm: BgmState | null; enabled: boolean; send: (c: ClientCommand) => unknown }) {
  const input = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<AudioKind>("bgm");
  const [volume, setVolume] = useState(80);
  const [fadeMs, setFadeMs] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const assetId = await uploadAudio(me, file);
      const name = label.trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "이름 없는 음원";
      if (send({ type: "audio.track.add", data: { label: name, kind, assetId, volume } }) !== false) setLabel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "음원을 올리지 못했어요.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const nowPlaying = bgm ? library.find((t) => t.assetId === bgm.assetId && t.kind === "bgm") : undefined;

  return (
    <div style={{ padding: 16, display: "grid", gap: 12, alignContent: "start", overflow: "auto", flex: 1 }} data-testid="audio-panel">
      <div className="card" style={{ gap: 8 }} data-testid="audio-now">
        <strong>지금 흐르는 배경음</strong>
        {bgm ? (
          <>
            <span data-testid="audio-now-name">{nowPlaying?.label ?? "(라이브러리에 없는 음원)"}</span>
            <label style={{ display: "grid", gap: 2, fontSize: 13 }}>
              볼륨 {bgm.volume}
              <input type="range" min={0} max={100} value={bgm.volume} aria-label="배경음 전체 볼륨" disabled={!enabled} onChange={(e) => send({ type: "audio.volume", data: { volume: Number(e.target.value) } })} style={{ accentColor: "#7c86f7" }} />
            </label>
            <button className="btn" disabled={!enabled} onClick={() => send({ type: "audio.stop", data: { fadeMs } })}>정지</button>
          </>
        ) : (
          <span style={{ color: "var(--muted)" }}>없음</span>
        )}
        <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
          페이드
          <select className="input" aria-label="페이드 시간" value={fadeMs} onChange={(e) => setFadeMs(Number(e.target.value))} style={{ height: 28 }}>
            {FADES.map((f) => (
              <option key={f} value={f}>{f === 0 ? "없음" : `${f / 1000}초`}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="card" style={{ gap: 8 }}>
        <strong>음원 올리기</strong>
        <input className="input" aria-label="음원 이름" placeholder="이름 (비우면 파일 이름)" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
        <div style={{ display: "flex", gap: 8 }}>
          <select className="input" aria-label="음원 종류" value={kind} onChange={(e) => setKind(e.target.value as AudioKind)}>
            <option value="bgm">배경음 (반복)</option>
            <option value="se">효과음 (한 번)</option>
          </select>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, whiteSpace: "nowrap" }}>
            기본 볼륨 {volume}
            <input type="range" min={0} max={100} value={volume} aria-label="기본 볼륨" onChange={(e) => setVolume(Number(e.target.value))} style={{ accentColor: "#7c86f7" }} />
          </label>
        </div>
        <button className="btn primary" disabled={!enabled || busy || library.length >= MAX_AUDIO_TRACKS} onClick={() => input.current?.click()}>
          {busy ? "올리는 중…" : "파일 고르기"}
        </button>
        <input ref={input} type="file" accept="audio/mpeg,audio/ogg,audio/wav,audio/mp4,audio/webm,audio/x-wav,audio/aac" aria-label="음원 파일" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <span style={{ color: "var(--muted)", fontSize: 12 }}>mp3, ogg, wav, m4a · 10MB까지 · {library.length}/{MAX_AUDIO_TRACKS}</span>
        {error && <span role="alert" style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span>}
      </div>

      <div style={{ display: "grid", gap: 8 }} data-testid="audio-library">
        {library.length === 0 && <div style={{ color: "var(--muted)" }}>올려 둔 음원이 없어요.</div>}
        {library.map((t) => (
          <div key={t.id} className="card" data-testid="audio-track" style={{ gap: 6 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <strong style={{ flex: 1 }}>{t.label}</strong>
              <span className="badge">{KIND_LABEL[t.kind]}</span>
              {bgm?.assetId === t.assetId && t.kind === "bgm" && <span className="badge" data-testid="audio-playing">재생 중</span>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--muted)", fontSize: 12, flex: 1 }}>기본 볼륨 {t.volume}</span>
              <button className="btn" disabled={!enabled} onClick={() => send({ type: "audio.play", data: { trackId: t.id, fadeMs: t.kind === "bgm" ? fadeMs : 0 } })}>재생</button>
              <button className="btn" disabled={!enabled} aria-label={`${t.label} 삭제`} onClick={() => send({ type: "audio.track.remove", data: { id: t.id } })}>삭제</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
