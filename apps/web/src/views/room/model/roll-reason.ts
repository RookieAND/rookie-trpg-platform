import type { Role, SessionStatus } from "@coc-vtt/shared";

/** 굴리기 칸·버튼이 막혀 있는 이유 한 줄. 굴릴 수 있으면 null. */
export function rollBlockReason(role: Role, status: SessionStatus): string | null {
  if (role === "spectator") return "관전자는 굴릴 수 없어요.";
  if (status === "IDLE") return role === "kp" ? "세션을 시작하면 굴릴 수 있어요. 위의 ‘세션 시작’을 눌러 주세요." : "GM이 세션을 시작하면 굴릴 수 있어요.";
  if (status === "PAUSED") return role === "kp" ? "일시정지 중에는 굴릴 수 없어요. ‘이어하기’를 눌러 주세요." : "일시정지 중에는 굴릴 수 없어요. GM이 이어갈 때까지 기다려 주세요.";
  return null;
}
