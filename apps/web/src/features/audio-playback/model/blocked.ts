/**
 * 브라우저가 소리를 막고 있는지. 소리를 낼 일이 있는데(배경음이 흐르는 중, 음소거 아님)
 * 아직 오디오를 풀지 못했거나 컨텍스트가 멈춰 있으면 막힌 것이다.
 */
export function isAudioBlocked(o: { wantsSound: boolean; unlocked: boolean; ctxState: AudioContextState | "none" }): boolean {
  if (!o.wantsSound) return false;
  return !o.unlocked || o.ctxState !== "running";
}
