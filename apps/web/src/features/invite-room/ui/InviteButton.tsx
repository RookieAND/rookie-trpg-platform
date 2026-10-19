"use client";
import { useState } from "react";
import type { ClientCommand, Member } from "@coc-vtt/shared";
import { createSpectatorInvite, getRoom, regenerateInvite, revokeSpectatorInvite, type Invite } from "@/entities/room";
import type { Identity } from "@/entities/user";
import { Dialog, useAsk } from "@/shared/ui";

const EXPIRY: Array<{ label: string; minutes: number | null }> = [
  { label: "만료 없음", minutes: null },
  { label: "1시간", minutes: 60 },
  { label: "하루", minutes: 60 * 24 },
  { label: "7일", minutes: 60 * 24 * 7 },
];

/**
 * GM이 초대 링크를 보고 복사한다. 창을 여는 것만으로는 링크가 바뀌지 않는다.
 * 만료·인원을 정해 "새 링크 만들기"를 누를 때만 새 코드가 발급되고, 이전 링크는 못 쓰게 된다.
 * 읽기만 하는 "관전 링크"도 따로 만들 수 있고, 들어와 있는 관전자를 여기서 내보낸다.
 */
export function InviteButton({ me, roomId, members = [], send }: { me: Identity; roomId: string; members?: readonly Member[]; send?: (c: ClientCommand) => unknown }) {
  const ask = useAsk();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [spec, setSpec] = useState<Invite | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"pl" | "spectator" | null>(null);
  const [expiry, setExpiry] = useState<number | null>(null);
  const [max, setMax] = useState(8);
  const [specExpiry, setSpecExpiry] = useState<number | null>(null);
  const [specMax, setSpecMax] = useState(10);

  const show = async () => {
    setError(null);
    setCopied(null);
    try {
      const room = await getRoom(me, roomId);
      // 이미 발급된 링크가 있으면 그대로 보여 준다. 정보가 없을 때만 처음 발급한다.
      const current = room.invite ?? (await regenerateInvite(me, roomId));
      setInvite(current);
      setMax(current.maxMembers);
      setSpec(room.spectatorInvite ?? null);
      if (room.spectatorInvite) setSpecMax(room.spectatorInvite.maxMembers);
      setOpen(true);
    } catch {
      setError("초대 링크를 불러오지 못했어요. 잠시 뒤에 다시 눌러 주세요.");
      setOpen(true);
    }
  };

  const renew = async () => {
    if (invite && !(await ask.confirm({ title: "새 링크를 만들까요?", message: "이전에 보낸 링크는 못 써요.", confirmLabel: "새 링크 만들기" }))) return;
    setError(null);
    setCopied(null);
    try {
      setInvite(await regenerateInvite(me, roomId, { expiresInMinutes: expiry, maxMembers: max }));
    } catch {
      setError("새 링크를 만들지 못했어요. 잠시 뒤에 다시 시도해 주세요.");
    }
  };

  const makeSpec = async () => {
    if (spec && !(await ask.confirm({ title: "새 관전 링크를 만들까요?", message: "이전 관전 링크는 못 써요. 이미 들어온 관전자는 그대로 있어요.", confirmLabel: "새 링크 만들기" }))) return;
    setError(null);
    setCopied(null);
    try {
      setSpec(await createSpectatorInvite(me, roomId, { expiresInMinutes: specExpiry, maxMembers: specMax }));
    } catch {
      setError("관전 링크를 만들지 못했어요. 잠시 뒤에 다시 시도해 주세요.");
    }
  };

  const stopSpec = async () => {
    if (!(await ask.confirm({ title: "관전 링크를 끌까요?", message: "이 링크로는 더 들어올 수 없어요. 이미 들어온 관전자는 그대로 있어요.", confirmLabel: "끄기", danger: true }))) return;
    setError(null);
    try {
      await revokeSpectatorInvite(me, roomId);
      setSpec(null);
    } catch {
      setError("관전 링크를 끄지 못했어요. 잠시 뒤에 다시 시도해 주세요.");
    }
  };

  const kick = async (m: Member) => {
    if (!send) return;
    if (!(await ask.confirm({ title: `${m.name} 님을 내보낼까요?`, message: "관전에서 나가요. 관전 링크가 켜져 있으면 다시 들어올 수 있어요.", confirmLabel: "내보내기", danger: true }))) return;
    send({ type: "member.remove", data: { userId: m.userId } });
  };

  const linkOf = (code: string) => `${window.location.origin}/join/${roomId}?invite=${code}`;
  const copy = async (kind: "pl" | "spectator", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      setError("복사하지 못했어요. 주소를 눌러 직접 복사해 주세요.");
    }
  };
  const spectators = members.filter((m) => m.role === "spectator");
  const until = (i: Invite) => (i.expiresAt ? `${new Date(i.expiresAt).toLocaleString("ko-KR")}까지` : "만료 없음");

  return (
    <>
      {ask.node}
      <button className="btn keep" onClick={show} title="초대 링크를 보고 PL이나 관전자를 불러요">초대</button>
      {open && (
        <Dialog label="초대 링크" onClose={() => setOpen(false)} className="dialog">
          <strong>초대 링크</strong>
          {invite && (
            <>
              <div className="menu-label" style={{ padding: "2px 0 0" }}>PL 초대</div>
              <input className="input" readOnly value={linkOf(invite.code)} aria-label="초대 링크 주소" onFocus={(e) => e.currentTarget.select()} />
              <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
                최대 {invite.maxMembers}명 · {until(invite)}
              </span>
              <div className="btn-row">
                <button className="btn primary" onClick={() => copy("pl", linkOf(invite.code))}>{copied === "pl" ? "복사했어요" : "복사"}</button>
                <button className="btn ghost" onClick={() => setOpen(false)}>닫기</button>
              </div>
              <div className="menu-label" style={{ padding: "6px 0 0" }}>새 링크 만들기</div>
              <div className="btn-row">
                <label className="field" style={{ flex: 1 }}>
                  만료
                  <select className="input" aria-label="초대 만료" value={expiry ?? ""} onChange={(e) => setExpiry(e.target.value === "" ? null : Number(e.target.value))}>
                    {EXPIRY.map((x) => (
                      <option key={x.label} value={x.minutes ?? ""}>{x.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field" style={{ width: 90 }}>
                  최대 인원
                  <input className="input" type="number" min={2} max={12} aria-label="초대 최대 인원" value={max} onChange={(e) => setMax(Math.min(12, Math.max(2, Number(e.target.value) || 2)))} />
                </label>
              </div>
              <button className="btn" onClick={renew}>새 링크 만들기</button>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>새 링크를 만들면 이전 링크는 못 써요. 이미 들어온 사람은 그대로 들어올 수 있어요.</span>

              <div className="sep-line" role="separator" />
              <div className="menu-label" style={{ padding: "2px 0 0" }} data-testid="spectator-section">관전 링크 (읽기만 해요)</div>
              {spec ? (
                <>
                  <input className="input" readOnly value={linkOf(spec.code)} aria-label="관전 링크 주소" data-testid="invite-spectator-link" onFocus={(e) => e.currentTarget.select()} />
                  <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
                    관전자 최대 {spec.maxMembers}명 · {until(spec)}
                  </span>
                  <div className="btn-row">
                    <button className="btn primary" data-testid="invite-spectator-copy" onClick={() => copy("spectator", linkOf(spec.code))}>{copied === "spectator" ? "복사했어요" : "관전 링크 복사"}</button>
                    <button className="btn danger" data-testid="invite-spectator-off" onClick={stopSpec}>링크 끄기</button>
                  </div>
                </>
              ) : (
                <span style={{ color: "var(--muted)", fontSize: 12.5 }}>관전 링크로 들어온 사람은 보드와 공개된 굴림·핸드아웃만 볼 수 있고, 아무것도 바꿀 수 없어요.</span>
              )}
              <div className="btn-row">
                <label className="field" style={{ flex: 1 }}>
                  만료
                  <select className="input" aria-label="관전 링크 만료" value={specExpiry ?? ""} onChange={(e) => setSpecExpiry(e.target.value === "" ? null : Number(e.target.value))}>
                    {EXPIRY.map((x) => (
                      <option key={x.label} value={x.minutes ?? ""}>{x.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field" style={{ width: 90 }}>
                  최대 관전자
                  <input className="input" type="number" min={1} max={30} aria-label="관전자 최대 인원" value={specMax} onChange={(e) => setSpecMax(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} />
                </label>
              </div>
              <button className="btn" data-testid="invite-spectator-make" onClick={makeSpec}>{spec ? "새 관전 링크 만들기" : "관전 링크 만들기"}</button>

              <div className="menu-label" style={{ padding: "6px 0 0" }}>들어와 있는 관전자 {spectators.length}명</div>
              {spectators.length === 0 ? (
                <span style={{ color: "var(--muted)", fontSize: 12.5 }} data-testid="spectator-empty">아직 없어요.</span>
              ) : (
                <ul className="spec-list" data-testid="spectator-list">
                  {spectators.map((m) => (
                    <li key={m.userId} data-testid={`spectator-${m.name}`}>
                      <span>{m.name}{m.online ? "" : " (오프라인)"}</span>
                      <button className="btn sm danger" data-testid={`spectator-remove-${m.name}`} aria-label={`${m.name} 내보내기`} disabled={!send} onClick={() => kick(m)}>내보내기</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {error && <div className="err" role="alert">{error}</div>}
          {!invite && <button className="btn ghost" onClick={() => setOpen(false)}>닫기</button>}
        </Dialog>
      )}
    </>
  );
}
