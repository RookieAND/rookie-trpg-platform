"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@coc-vtt/shared";

/** seen보다 새로 온, 내가 쓰지 않은 대화 수 */
export const countUnread = (messages: readonly Pick<ChatMessage, "seq" | "userId">[], seenSeq: number, meId: string) =>
  messages.reduce((n, m) => (m.seq > seenSeq && m.userId !== meId ? n + 1 : n), 0);

/** 가장 큰 seq(없으면 0) */
export const lastSeqOf = (messages: readonly Pick<ChatMessage, "seq">[]) => messages.reduce((m, x) => Math.max(m, x.seq), 0);

/**
 * 안 읽은 대화 수. 접속하며 받은 지난 대화(ready가 되는 순간까지 쌓인 것)는 읽은 것으로 치고, 그 뒤 새로 온 남의 대화만 센다.
 * 대화 탭을 보고 있는 동안(viewing)에는 오는 대로 읽은 것으로 친다. 이전 대화를 위로 불러온 것은 새 대화가 아니라 세지 않는다.
 */
export function useChatUnread(messages: readonly ChatMessage[], opts: { ready: boolean; viewing: boolean; meId: string }): number {
  const seen = useRef<number | null>(null);
  const [unread, setUnread] = useState(0);
  const last = lastSeqOf(messages);
  useEffect(() => {
    if (!opts.ready) return;
    if (seen.current === null || opts.viewing) seen.current = Math.max(seen.current ?? 0, last);
    const next = countUnread(messages, seen.current, opts.meId);
    setUnread((prev) => (prev === next ? prev : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, messages.length, opts.ready, opts.viewing, opts.meId]);
  return unread;
}
