"use client";
import { useRef, useState } from "react";
import { uploadImage, type Caller } from "../api";

/** 파일을 골라 올리고, 끝나면 이미지 id를 알려 주는 버튼. */
export function ImageUploadButton({ me, label, onUploaded, disabled, className = "btn" }: { me: Caller; label: string; onUploaded: (id: string) => void; disabled?: boolean; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onUploaded(await uploadImage(me, file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지를 올리지 못했어요.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button type="button" className={className} disabled={disabled || busy} onClick={() => input.current?.click()}>
        {busy ? "올리는 중…" : label}
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label={`${label} 파일`} hidden onChange={(e) => pick(e.target.files?.[0])} />
      {error && <span role="alert" style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span>}
    </span>
  );
}
