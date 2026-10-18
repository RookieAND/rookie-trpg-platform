export type ToastKind = "error" | "info";

/** 토스트 안의 버튼(예: 되돌리기). 누르면 run을 부르고 토스트를 닫는다. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  /** 사라지기까지(ms) */
  ttl: number;
  action?: ToastAction;
}

export const ERROR_TTL = 5000;
export const INFO_TTL = 3000;
/** 버튼이 붙은 안내는 누를 시간을 더 준다. */
export const ACTION_TTL = 10000;
/** 한꺼번에 쌓아 두는 토스트 수. 넘으면 오래된 것부터 밀어낸다. */
export const MAX_TOASTS = 4;

/** 같은 문구가 이미 떠 있으면 새로 띄우지 않고 맨 뒤로 옮겨 시간을 다시 센다(새 id). */
export function pushToast(list: Toast[], t: Omit<Toast, "id">, id: number): Toast[] {
  return [...list.filter((x) => x.text !== t.text), { ...t, id }].slice(-MAX_TOASTS);
}

const ERROR_TEXT: Record<string, string> = {
  bad_message: "요청이 올바르지 않아요. 다시 시도해 주세요.",
  forbidden: "이 조작은 할 수 없어요.",
  not_found: "찾을 수 없어요. 이미 지워졌을 수 있어요.",
  stale: "다른 사람이 먼저 바꿨어요. 최신 내용을 확인하고 다시 해 주세요.",
  paused: "세션이 일시정지 중이라 할 수 없어요.",
  idle: "세션을 시작한 뒤에 할 수 있어요.",
  bad_roll: "굴림 식을 확인해 주세요. 예: 1d100, CC<=60",
  bad_sheet: "시트 값을 확인해 주세요.",
  rate_limited: "너무 빨리 바꾸고 있어요. 잠시 뒤에 다시 해 주세요.",
};

/** 서버가 보낸 오류를 해요체 문장으로. 문장(한글)이면 그대로 쓰고, 코드만 오거나 비어 있으면 코드별 문장으로 바꾼다. */
export function humanizeError(e: { code: string; message?: string }): string {
  const m = e.message?.trim() ?? "";
  if (/[가-힣]/.test(m)) return m;
  return ERROR_TEXT[e.code] ?? "문제가 생겼어요. 잠시 뒤에 다시 해 주세요.";
}

export const SEND_FAILED_TEXT = "연결이 끊겨서 보내지 못했어요. 다시 연결 중이에요";
export const RECONNECTED_TEXT = "다시 연결됐어요";
