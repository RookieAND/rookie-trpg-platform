"use client";
import { useState } from "react";
import { getDiscord, saveDiscord, testDiscord, type DiscordSettings } from "@/entities/room";
import type { Identity } from "@/entities/user";
import { ApiError } from "@/shared/api";
import { Dialog } from "@/shared/ui";

/** KP가 디스코드 채널 웹훅을 연결하고 알림 종류를 고른다. */
export function DiscordButton({ me, roomId }: { me: Identity; roomId: string }) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<DiscordSettings | null>(null);
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");

  const fail = (e: unknown) => setMsg(e instanceof ApiError ? e.message : "처리하지 못했어요.");

  const show = async () => {
    setOpen(true);
    setMsg("");
    setUrl("");
    try {
      setCfg(await getDiscord(me, roomId));
    } catch (e) {
      fail(e);
    }
  };

  const save = async (webhookUrl: string | null | undefined, events = cfg?.events ?? { session: true, rolls: true }) => {
    try {
      setCfg(await saveDiscord(me, roomId, webhookUrl, events));
      setUrl("");
      setMsg(webhookUrl === null ? "연결을 해제했어요." : "저장했어요.");
    } catch (e) {
      fail(e);
    }
  };

  const test = async () => {
    try {
      await testDiscord(me, roomId);
      setMsg("시험 메시지를 보냈어요. 디스코드 채널을 확인해 보세요.");
    } catch (e) {
      fail(e);
    }
  };

  const toggle = (key: "session" | "rolls") => {
    if (!cfg) return;
    const events = { ...cfg.events, [key]: !cfg.events[key] };
    setCfg({ ...cfg, events });
    // 이미 연결돼 있으면 서버 설정도 바로 바꾼다(주소는 생략해서 서버에 있는 것을 유지).
    if (cfg.connected) void save(undefined, events);
  };

  return (
    <>
      <button className="btn" onClick={show}>디스코드</button>
      {open && (
        <Dialog label="디스코드 알림" onClose={() => setOpen(false)} className="dialog">
          <strong>디스코드 알림</strong>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
            {cfg?.connected ? "채널이 연결돼 있어요. 주소는 안전을 위해 다시 보여 주지 않아요." : "채널 설정 → 연동 → 웹훅에서 URL을 복사해 붙여 넣어 주세요."}
          </span>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" aria-label="웹훅 주소" />
          {cfg && (
            <>
              <label><input type="checkbox" checked={cfg.events.session} onChange={() => toggle("session")} /> 세션 시작·정지·종료</label>
              <label><input type="checkbox" checked={cfg.events.rolls} onChange={() => toggle("rolls")} /> 공개 굴림 결과 (비밀 굴림은 보내지 않아요)</label>
            </>
          )}
          {msg && <span role="status" style={{ fontSize: 12.5 }}>{msg}</span>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" disabled={!url.trim()} onClick={() => save(url.trim())}>저장</button>
            <button className="btn" disabled={!cfg?.connected} onClick={test}>시험 메시지</button>
            <button className="btn" disabled={!cfg?.connected} onClick={() => save(null)}>해제</button>
            <button className="btn" onClick={() => setOpen(false)}>닫기</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
