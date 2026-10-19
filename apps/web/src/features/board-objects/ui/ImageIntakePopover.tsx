"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { uploadImageFile, type Caller } from "@/shared/api";
import { ImagePicker, useImageLibrary, useImageUpload } from "@/shared/ui";
import { clampToViewport } from "../model/object-actions";
import { intakeOptions, type IntakeChoice } from "../model/intake";

/** 떠 있는 상자가 바깥을 누르거나 Esc를 누르면 닫히게 한다. */
function useDismiss(root: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [root, onClose]);
}

function useAnchor(root: React.RefObject<HTMLElement | null>, cx: number, cy: number) {
  const [pos, setPos] = useState({ left: cx, top: cy });
  useLayoutEffect(() => {
    const r = root.current?.getBoundingClientRect();
    if (r) setPos(clampToViewport(cx, cy, r.width, r.height, window.innerWidth, window.innerHeight));
  }, [root, cx, cy]);
  return pos;
}

/**
 * 빈 보드에 이미지를 놓거나 붙여 넣었을 때 쓰임을 묻는 작은 상자(배경 / 새 토큰 / 소품).
 * 고르면 그때 올리고 id를 알려 준다. 올리기에 실패하면 상자는 그대로 두고 이유를 보여 준다.
 */
export function ImageIntakePopover({ me, file, at, selected, onChoose, onClose }: { me: Caller; file: File; at: { cx: number; cy: number }; selected?: { name: string }; onChoose: (choice: IntakeChoice, image: string) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const pos = useAnchor(root, at.cx, at.cy);
  const { remember } = useImageLibrary();
  const [busy, setBusy] = useState<IntakeChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 미리보기 주소는 효과 안에서 만들고 거둔다(개발 모드의 이중 실행에서도 깨지지 않게)
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useDismiss(root, onClose);
  useEffect(() => root.current?.querySelector<HTMLElement>("button")?.focus(), []);

  const choose = async (choice: IntakeChoice) => {
    setBusy(choice);
    setError(null);
    try {
      const id = await uploadImageFile(me, file);
      remember(id);
      onChoose(choice, id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지를 올리지 못했어요.");
      setBusy(null);
    }
  };

  return (
    <div ref={root} className="intake-pop" role="menu" aria-label="이미지를 어디에 쓸까요" data-testid="image-intake" style={{ left: pos.left, top: pos.top }}>
      <div className="intake-head">
        {preview && <img src={preview} alt="" />}
        <span>이 이미지를</span>
      </div>
      {intakeOptions(selected).map((o) => (
        <button key={o.choice} type="button" role="menuitem" disabled={busy !== null} data-testid={`intake-${o.choice}`} onClick={() => choose(o.choice)}>
          {busy === o.choice ? "올리는 중…" : o.label}
        </button>
      ))}
      <button type="button" role="menuitem" className="quiet" onClick={onClose}>취소</button>
      {error && <span role="alert" className="intake-err">{error}</span>}
    </div>
  );
}

/** 토큰·소품 하나의 이미지를 고르는 상자. 이 룸에서 쓴 이미지를 다시 고르거나 새 파일을 올린다. */
export function ObjectImagePopover({ me, current, at, onPick, onClose }: { me: Caller; current?: string | null; at: { cx: number; cy: number }; onPick: (image: string) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pos = useAnchor(root, at.cx, at.cy);
  const { ids } = useImageLibrary();
  const { busy, error, upload } = useImageUpload(me, onPick);
  useDismiss(root, onClose);
  return (
    <div ref={root} className="intake-pop wide" data-testid="object-image-pop" style={{ left: pos.left, top: pos.top }}>
      <ImagePicker ids={ids} current={current} busy={busy} error={error} onUpload={() => input.current?.click()} onPick={onPick} onClose={onClose} />
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        aria-label="토큰·소품 이미지 파일"
        hidden
        onChange={async (e) => {
          await upload(e.target.files?.[0]);
          if (input.current) input.current.value = "";
        }}
      />
    </div>
  );
}
