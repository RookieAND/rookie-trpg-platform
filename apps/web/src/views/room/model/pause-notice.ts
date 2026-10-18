import type { PauseReason, Role } from "@coc-vtt/shared";

/**
 * 일시정지 배너 문구. GM이 직접 멈췄는데 "GM이 돌아오면"이라고 하면 어색하므로
 * 멈춘 이유(자동/직접)와 보는 사람(GM/그 밖)에 따라 나눈다.
 * 연결 끊김으로 자동 정지한 경우의 앞부분("세션이 일시정지 중이에요")은 e2e가 기대하는 문구라 그대로 둔다.
 */
export function pauseNotice(role: Role, reason: PauseReason | null): string {
  if (role === "kp") return "일시정지 중이에요 · 위의 ‘이어하기’를 누르면 계속돼요";
  if (reason === "kp_request") return "세션이 일시정지 중이에요. GM이 이어하기를 누르면 계속돼요.";
  return "세션이 일시정지 중이에요. GM이 돌아오면 이어서 진행해요.";
}
