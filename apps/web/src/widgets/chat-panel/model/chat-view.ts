import { parseChatInput, type ChatInput, type ChatMessage, type ChatTarget, type Member, type Role } from "@coc-vtt/shared";

export type SpeakerChoice = { kind: "self" } | { kind: "gm" } | { kind: "character"; id: string };

export const speakerValue = (s: SpeakerChoice) => (s.kind === "character" ? `c:${s.id}` : s.kind);
export const speakerFromValue = (v: string): SpeakerChoice => (v.startsWith("c:") ? { kind: "character", id: v.slice(2) } : v === "gm" ? { kind: "gm" } : { kind: "self" });

/** 서버로 보낼 speaker 필드 */
export function speakerField(s: SpeakerChoice): { characterId: string } | { gm: true } | undefined {
  return s.kind === "character" ? { characterId: s.id } : s.kind === "gm" ? { gm: true } : undefined;
}

/** 귓속말을 보낼 수 있는 사람: GM은 모든 PL에게, PL은 GM에게(PL끼리는 GM이 허용했을 때만). 관전자는 보낼 수 없다. */
export function whisperRecipients(members: readonly Member[], meId: string, role: Role, plWhisper: boolean): Member[] {
  if (role === "spectator") return [];
  return members.filter((m) => {
    if (m.userId === meId || m.role === "spectator") return false;
    if (role === "kp") return m.role === "pl";
    return m.role === "kp" || (plWhisper && m.role === "pl");
  });
}

/** 서버와 같은 규칙으로 /w 이름을 풀기 위한 목록(PL의 캐릭터 이름은 GM 화면에서만 부를 수 있다) */
export function chatTargets(members: readonly Member[], meId: string, role: Role, characters: ReadonlyArray<{ name: string; ownerId: string }>): ChatTarget[] {
  return members
    .filter((m) => m.userId !== meId && m.role !== "spectator")
    .map((m) => ({
      userId: m.userId,
      names: [m.name, ...(m.role === "kp" ? ["GM"] : role === "kp" ? characters.filter((c) => c.ownerId === m.userId).map((c) => c.name) : [])],
    }));
}

export type DraftCheck = { kind: "send" } | { kind: "help" } | { kind: "error"; message: string };

/** 보내기 전에 화면에서 먼저 검사한다. 서버가 같은 규칙으로 다시 검사한다. */
export function checkDraft(text: string, o: { targets: ChatTarget[]; whisperTo: string; canRoll: boolean; rollWhy: string | null; recipientIds: readonly string[] }): DraftCheck {
  if (!text.trim()) return { kind: "error", message: "보낼 내용을 적어 주세요." };
  if (o.whisperTo) return { kind: "send" }; // 받는 사람을 골랐으면 글은 그대로 귓속말이다
  const p: ChatInput = parseChatInput(text, o.targets);
  if (p.type === "help") return { kind: "help" };
  if (p.type === "error") return { kind: "error", message: p.message };
  if (p.type === "roll" && !o.canRoll) return { kind: "error", message: o.rollWhy ?? "지금은 굴릴 수 없어요." };
  if (p.type === "whisper" && !o.recipientIds.includes(p.to)) return { kind: "error", message: o.recipientIds.length === 0 ? "귓속말을 보낼 수 없어요." : "PL끼리 귓속말은 GM이 허용했을 때만 보낼 수 있어요." };
  return { kind: "send" };
}

/** 한 줄 머리에 붙일 시각(HH:mm, 보는 사람의 시간대) */
export const chatTime = (at: number) => new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));

/** 귓속말의 방향 표시: "나 → 도윤", "서하 → 나" */
export function whisperLabel(m: Pick<ChatMessage, "name" | "userId" | "to">, meId: string): string {
  if (!m.to) return "";
  return m.userId === meId ? `나 → ${m.to.name}` : m.to.userId === meId ? `${m.name} → 나` : `${m.name} → ${m.to.name}`;
}

/** 스크롤이 바닥 근처인가 */
export const nearBottom = (el: { scrollHeight: number; scrollTop: number; clientHeight: number }, slack = 80) => el.scrollHeight - el.scrollTop - el.clientHeight <= slack;

/** 입력 중 Enter로 보내도 되는가: Shift가 없고, 한글 같은 글자 조합 중이 아니다. */
export function shouldSendOnEnter(e: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number }, composing: boolean): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  if (composing || e.isComposing || e.keyCode === 229) return false;
  return true;
}
