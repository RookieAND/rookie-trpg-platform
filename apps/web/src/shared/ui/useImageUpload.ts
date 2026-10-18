"use client";
import { useCallback, useState } from "react";
import { uploadImageFile, type Caller } from "../api";
import { useImageLibrary } from "./ImageLibrary";

/** 파일을 확인·줄여서 올리고, 끝나면 이미지 id를 알려 준다. 올린 이미지는 고르기 목록에 기억해 둔다. */
export function useImageUpload(me: Caller, onUploaded: (id: string) => void) {
  const { remember } = useImageLibrary();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const id = await uploadImageFile(me, file);
        remember(id);
        onUploaded(id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "이미지를 올리지 못했어요.");
      } finally {
        setBusy(false);
      }
    },
    [me, onUploaded, remember],
  );
  return { busy, error, upload, clearError: () => setError(null) };
}
