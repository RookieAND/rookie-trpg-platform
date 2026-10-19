"use client";
import { useRef, useState } from "react";
import { LIMITS } from "@coc-vtt/shared";
import { createRoom } from "@/entities/room";
import { LimitNote } from "@/shared/ui";
import { ApiError } from "@/shared/api";
import type { Identity } from "@/entities/user";

export function CreateRoomForm({ me, onCreated, onError }: { me: Identity; onCreated: (roomId: string) => void; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) return inputRef.current?.focus();
    setBusy(true);
    try {
      onCreated((await createRoom(me, name)).id);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "룸을 만들지 못했어요.");
      setBusy(false);
    }
  };

  return (
    <div className="toolbar">
      <input ref={inputRef} className="input" style={{ width: 200 }} aria-label="새 룸 이름" placeholder="새 룸 이름" value={name} maxLength={LIMITS.roomName} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <LimitNote label="룸 이름" max={LIMITS.roomName} value={name} />
      <button className="btn primary" disabled={busy} onClick={submit}>{busy ? "만드는 중…" : "새 룸 만들기"}</button>
    </div>
  );
}
