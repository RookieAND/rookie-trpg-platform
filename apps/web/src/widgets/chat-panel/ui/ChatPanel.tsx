"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CHAT_HELP_LINES, CHAT_HISTORY_ON_JOIN, CHAT_MAX_LENGTH, type ChatMessage, type ClientCommand, type Member, type Role } from "@coc-vtt/shared";
import { chatTargets, chatTime, checkDraft, nearBottom, shouldSendOnEnter, speakerField, speakerFromValue, speakerValue, whisperLabel, whisperRecipients, type SpeakerChoice } from "../model/chat-view";

export interface ChatPanelProps {
  messages: readonly ChatMessage[];
  members: readonly Member[];
  meId: string;
  meName: string;
  role: Role;
  /** 이 사람이 "캐릭터로 말하기"에 쓸 수 있는 시트(PL은 자기 것, GM은 NPC 시트) */
  speakable: ReadonlyArray<{ id: string; name: string }>;
  /** 이름으로 귓속말 상대를 찾을 때 쓸 캐릭터(GM 화면에서만 PL의 캐릭터 이름을 부를 수 있다) */
  characters: ReadonlyArray<{ name: string; ownerId: string }>;
  plWhisper: boolean;
  /** 굴림을 굴릴 수 없는 이유(굴릴 수 있으면 null) */
  rollWhy: string | null;
  /** 이 탭을 보고 있는가(숨겨 둘 뿐 지우지 않아서 쓰던 글과 스크롤이 남는다) */
  visible: boolean;
  ready: boolean;
  send: (c: ClientCommand) => unknown;
  onSetPlWhisper?: (on: boolean) => void;
  /** 이 번호(seq)보다 앞의 대화를 불러온다. 더 있으면 true */
  onLoadOlder: (before: number) => Promise<boolean>;
}

export function ChatPanel(p: ChatPanelProps) {
  const { messages, members, meId, role } = p;
  const spectator = role === "spectator";
  const [text, setText] = useState("");
  const [speaker, setSpeaker] = useState<SpeakerChoice>({ kind: "self" });
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [older, setOlder] = useState<"idle" | "loading" | "done">("idle");
  const [newBelow, setNewBelow] = useState(0);
  const composing = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // 바닥에 붙어 있는가
  const lastCount = useRef(0);
  const lastId = useRef<string | null>(null);

  const recipients = useMemo(() => whisperRecipients(members, meId, role, p.plWhisper), [members, meId, role, p.plWhisper]);
  const targets = useMemo(() => chatTargets(members, meId, role, p.characters), [members, meId, role, p.characters]);
  // 고른 상대/말하는 이름이 사라졌으면(나감·시트 삭제) 되돌린다.
  useEffect(() => {
    if (to && !recipients.some((m) => m.userId === to)) setTo("");
  }, [recipients, to]);
  useEffect(() => {
    if (speaker.kind === "character" && !p.speakable.some((c) => c.id === speaker.id)) setSpeaker({ kind: "self" });
  }, [p.speakable, speaker]);

  const scrollDown = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    stick.current = true;
    setNewBelow(0);
  };
  // 새 대화가 오면: 바닥에 있었거나 내가 쓴 것이면 따라 내려가고, 아니면 "새 메시지" 버튼을 띄운다.
  useLayoutEffect(() => {
    const el = listRef.current;
    const tail = messages.at(-1);
    const appended = tail && tail.id !== lastId.current;
    const added = messages.length - lastCount.current;
    lastCount.current = messages.length;
    lastId.current = tail?.id ?? null;
    if (!el || !p.visible) return;
    if (appended && (stick.current || tail.userId === meId)) scrollDown();
    else if (appended && added > 0) setNewBelow((n) => n + added);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, p.visible]);
  // 탭을 열면 맨 아래로
  useEffect(() => {
    if (p.visible) scrollDown();
  }, [p.visible]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stick.current = nearBottom(el);
    if (stick.current) setNewBelow(0);
  };

  const canWhisper = recipients.length > 0;
  const submit = () => {
    if (spectator && to) return;
    const c = checkDraft(text, { targets, whisperTo: to, canRoll: p.rollWhy === null, rollWhy: p.rollWhy, canWhisper });
    if (c.kind === "help") {
      setHelp(true);
      setText("");
      setError(null);
      return;
    }
    if (c.kind === "error") {
      setError(c.message);
      return;
    }
    const sp = spectator ? undefined : speakerField(speaker);
    const ok = p.send({ type: "chat.send", data: { text, ...(to ? { to } : {}), ...(sp ? { speaker: sp } : {}) } });
    if (ok === false) {
      setError("연결이 끊겨 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      return;
    }
    setText("");
    setError(null);
    setHelp(false);
    stick.current = true;
  };

  const loadOlder = async () => {
    const first = messages[0];
    if (!first || older === "loading") return;
    setOlder("loading");
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const more = await p.onLoadOlder(first.seq);
      setOlder(more ? "idle" : "done");
      // 위에 붙은 만큼 스크롤을 밀어서 읽던 자리를 지킨다.
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - prevHeight;
      });
    } catch {
      setOlder("idle");
      setError("이전 대화를 불러오지 못했어요.");
    }
  };

  const left = CHAT_MAX_LENGTH - text.length;
  const showOlder = older !== "done" && messages.length >= CHAT_HISTORY_ON_JOIN;

  return (
    <div className="chat" data-testid="chat-panel" hidden={!p.visible}>
      <div className="chat-list" ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-label="대화" data-testid="chat-list">
        {showOlder && (
          <button type="button" className="btn sm chat-older" data-testid="chat-load-older" disabled={older === "loading"} onClick={loadOlder}>
            {older === "loading" ? "불러오는 중…" : "이전 대화 보기"}
          </button>
        )}
        {messages.length === 0 && <p className="muted chat-empty">{p.ready ? "아직 대화가 없어요. 첫 마디를 남겨 보세요." : "불러오는 중이에요…"}</p>}
        {messages.map((m) => (
          <ChatLine key={m.id} m={m} meId={meId} />
        ))}
      </div>
      {newBelow > 0 && (
        <button type="button" className="chat-jump" data-testid="chat-jump-new" onClick={scrollDown}>
          새 메시지 {newBelow > 1 ? `${newBelow}개 ` : ""}↓
        </button>
      )}
      {help && (
        <div className="chat-help" data-testid="chat-help" role="note">
          <ul>
            {CHAT_HELP_LINES.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <button type="button" className="btn sm" onClick={() => setHelp(false)}>닫기</button>
        </div>
      )}
      <div className="chat-compose">
        {!spectator && (
          <div className="chat-row">
            <label className="chat-sel">
              <span className="muted">말하는 이름</span>
              <select className="input" data-testid="chat-speaker" value={speakerValue(speaker)} onChange={(e) => setSpeaker(speakerFromValue(e.target.value))}>
                <option value="self">{p.meName}</option>
                {role === "kp" && <option value="gm">GM</option>}
                {p.speakable.map((c) => (
                  <option key={c.id} value={`c:${c.id}`}>{c.name}{role === "kp" ? " (NPC)" : " (캐릭터)"}</option>
                ))}
              </select>
            </label>
            <label className="chat-sel">
              <span className="muted">받는 사람</span>
              <select className="input" data-testid="chat-to" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">모두</option>
                {recipients.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.role === "kp" ? `${m.name} (GM)` : m.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        {to && <p className="chat-whisper-note muted" data-testid="chat-whisper-note">귓속말이에요. 받는 사람만 볼 수 있어요.</p>}
        <div className="chat-row chat-input-row">
          <textarea
            className="input chat-input"
            data-testid="chat-input"
            aria-label="대화 입력"
            rows={2}
            value={text}
            maxLength={CHAT_MAX_LENGTH + 200}
            placeholder={spectator ? "관전자는 모두에게 보이는 말만 할 수 있어요" : "말하기 (/r 1d100 으로 굴리기)"}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onKeyDown={(e) => {
              if (shouldSendOnEnter({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }, composing.current)) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="chat-btns">
            <button type="button" className="btn primary" data-testid="chat-send" disabled={!text.trim() || left < 0} onClick={submit}>보내기</button>
            <button type="button" className="btn" data-testid="chat-help-btn" aria-label="명령어 도움말" aria-expanded={help} title="명령어 도움말" onClick={() => setHelp((h) => !h)}>?</button>
          </div>
        </div>
        <div className="chat-meta">
          <span className={left < 0 ? "chat-count over" : "chat-count muted"} data-testid="chat-count">{text.length}/{CHAT_MAX_LENGTH}</span>
          {role === "kp" && p.onSetPlWhisper && (
            <label className="chat-plw">
              <input type="checkbox" data-testid="chat-plwhisper" checked={p.plWhisper} onChange={(e) => p.onSetPlWhisper?.(e.target.checked)} /> PL끼리 귓속말
            </label>
          )}
        </div>
        {error && <div className="err" role="alert" data-testid="chat-error">{error}</div>}
      </div>
    </div>
  );
}

function ChatLine({ m, meId }: { m: ChatMessage; meId: string }) {
  const mine = m.userId === meId;
  const gm = m.role === "kp";
  return (
    <div className={`chat-msg ${m.kind}${mine ? " mine" : ""}`} data-testid="chat-msg" data-kind={m.kind} data-mine={mine ? "1" : "0"}>
      <div className="chat-head">
        <b className="chat-name">{m.name}</b>
        {gm && <span className="badge kp">GM</span>}
        {m.kind === "whisper" && <span className="badge plain chat-tag">귓속말 {whisperLabel(m, meId)}</span>}
        {m.kind === "secret" && <span className="badge plain chat-tag">비밀 굴림 (GM과 나만 봐요)</span>}
        <time className="muted chat-time" dateTime={new Date(m.at).toISOString()}>{chatTime(m.at)}</time>
      </div>
      {m.roll ? (
        <div className="chat-roll">
          <code>{m.roll.expr}</code> <span aria-hidden>→</span> <b>{m.roll.result}</b>
        </div>
      ) : (
        <div className="chat-text">{m.text}</div>
      )}
    </div>
  );
}
