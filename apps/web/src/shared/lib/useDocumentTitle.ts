"use client";
import { useEffect } from "react";

/** 브라우저 탭 제목을 바꾼다. null이면 건드리지 않고, 화면을 떠나면 원래 제목으로 돌린다. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

/** "룸 이름 · 서비스 이름" 꼴의 탭 제목 */
export function roomTitle(roomName: string | null | undefined, service: string): string {
  const n = roomName?.trim();
  return n ? `${n} · ${service}` : service;
}
