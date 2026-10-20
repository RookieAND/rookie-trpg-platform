"use client";
import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import type { Caller } from "../api";
import { useImageLibrary } from "./ImageLibrary";
import { ImagePicker } from "./ImagePicker";
import { useImageUpload } from "./useImageUpload";

/**
 * 이미지를 넣는 버튼. 이 룸에서 올린 이미지가 있으면 누를 때 '이미지 고르기'가 펼쳐져 다시 고를 수 있고,
 * 없으면 바로 파일 선택창이 열린다. 끝나면 이미지 id를 알려 준다.
 */
export function ImageUploadButton({ me, label, onUploaded, disabled, className = "btn", current }: { me: Caller; label: string; onUploaded: (id: string) => void; disabled?: boolean; className?: string; /** 지금 쓰고 있는 이미지(목록에서 표시) */ current?: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const { ids } = useImageLibrary();
  const done = (id: string) => {
    setOpen(false);
    onUploaded(id);
  };
  const { busy, error, upload } = useImageUpload(me, done);

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", position: "relative" }}>
      <button
        type="button"
        className={className}
        aria-expanded={ids.length > 0 ? open : undefined}
        disabled={disabled || busy}
        onClick={() => (ids.length > 0 ? setOpen((o) => !o) : input.current?.click())}
      >
        <ImagePlus aria-hidden />{busy ? "올리는 중…" : label}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        aria-label={`${label} 파일`}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          await upload(f);
          if (input.current) input.current.value = "";
        }}
      />
      {open && !disabled && <ImagePicker float ids={ids} current={current} busy={busy} error={error} onUpload={() => input.current?.click()} onPick={done} onClose={() => setOpen(false)} />}
      {!open && error && <span role="alert" style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span>}
    </span>
  );
}
