"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { ChatSettings, ClientCommand } from "@coc-vtt/shared";
import { purgeRoomHistory } from "@/entities/room";
import type { Identity } from "@/entities/user";
import { ApiError } from "@/shared/api";
import { Dialog, useAsk } from "@/shared/ui";

/** GM이 PL의 수치 직접 수정을 허용할지 고르고, 대화·세션 기록을 비운다. */
export function RoomSafetyButton({ me, roomId, settings, send }: { me: Identity; roomId: string; settings?: ChatSettings; send?: (c: ClientCommand) => unknown }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const ask = useAsk();
  const selfEdit = settings?.plSelfEdit !== false;

  const toggle = () => {
    if (!send || !settings) return;
    send({ type: "settings.chat", data: { plWhisper: settings.plWhisper, spectatorChat: settings.spectatorChat === true, plSelfEdit: !selfEdit } });
  };

  const purge = async (scope: "chat" | "log") => {
    const label = scope === "chat" ? "대화" : "세션 기록";
    if (!(await ask.confirm({ title: `${label}을 비울까요?`, message: "지운 기록은 되돌릴 수 없어요.", confirmLabel: "비우기", danger: true }))) return;
    try {
      await purgeRoomHistory(me, roomId, scope);
      setMsg(`${label}을 비웠어요.`);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "처리하지 못했어요.");
    }
  };

  return (
    <>
      <button className="btn" data-testid="room-safety-open" onClick={() => { setMsg(""); setOpen(true); }}><ShieldCheck aria-hidden />안전·기록</button>
      {open && (
        <Dialog label="안전·기록" onClose={() => setOpen(false)} className="dialog">
          <strong>안전·기록</strong>
          <label>
            <input type="checkbox" data-testid="pl-self-edit" checked={selfEdit} disabled={!send || !settings} onChange={toggle} /> PL이 자기 수치 직접 수정 허용
          </label>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>끄면 PL은 HP·MP·SAN·행운을 직접 고칠 수 없어요.</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn danger" data-testid="purge-chat" onClick={() => purge("chat")}>대화 기록 비우기</button>
            <button className="btn danger" data-testid="purge-log" onClick={() => purge("log")}>세션 기록 비우기</button>
            <button className="btn" onClick={() => setOpen(false)}>닫기</button>
          </div>
          {msg && <span role="status" style={{ fontSize: 12.5 }}>{msg}</span>}
          {ask.node}
        </Dialog>
      )}
    </>
  );
}
