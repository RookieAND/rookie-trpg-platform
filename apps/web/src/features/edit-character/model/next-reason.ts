export interface WizardState {
  step: number;
  name: string;
  ageOk: boolean;
  baseOk: boolean;
  /** 나이 보정 입력 오류(checkAgeAdjustment) */
  cutError: string | null;
  /** 교육 향상 판정이 필요한데 아직 안 했다 */
  eduPending: boolean;
  /** 기능 포인트 검사 오류들 */
  pointErrors: string[];
}

/** 마법사의 ‘다음’을 누를 수 없는 이유 한 줄. 누를 수 있으면 null. */
export function nextBlockReason(s: WizardState): string | null {
  if (s.step === 0) {
    if (!s.name.trim()) return "이름을 적으면 다음으로 갈 수 있어요.";
    if (!s.ageOk) return "나이는 15~90세 사이로 적어 주세요.";
  }
  if (s.step === 1) {
    if (!s.baseOk) return "특성치는 모두 1~99 사이로 적어 주세요.";
    if (s.cutError) return s.cutError;
    if (s.eduPending) return "‘교육 향상 판정’을 한 번 해야 다음으로 갈 수 있어요.";
  }
  if (s.step === 2 && s.pointErrors.length > 0) return `포인트를 맞춰 주세요 · ${s.pointErrors[0]}`;
  return null;
}
