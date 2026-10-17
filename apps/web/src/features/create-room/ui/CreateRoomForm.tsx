"use client";
import { useState } from "react";
import { createRoom } from "@/entities/room";
import { ApiError } from "@/shared/api";
import type { Identity } from "@/entities/user";

export function CreateRoomForm({ me, onCreated, onError }: { me: Identity; onCreated: (roomId: string) => void; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      onCreated((await createRoom(me, name)).id);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "룸을 만들지 못했어요.");
      setBusy(false);
    }
  };

  return (
    <>
      <input className="input" style={{ width: 220 }} aria-label="새 룸 이름" placeholder="새 룸 이름" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <button className="btn primary" disabled={!name.trim() || busy} onClick={submit}>새 룸 만들기</button>
    </>
  );
}
