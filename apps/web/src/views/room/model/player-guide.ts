/** PL(관전자 포함)용 시작 가이드의 단계와 완료 여부를 실제 룸 상태로 계산한다. 화면을 모르는 순수 함수. */

export interface PlayerGuideInput {
  role: "kp" | "pl" | "spectator";
  userId: string;
  characters: ReadonlyArray<{ ownerId: string }>;
  rolls: ReadonlyArray<{ userId: string }>;
  /** 서버가 이 사람에게 보내 준(볼 수 있는) 핸드아웃 */
  handouts: ReadonlyArray<{ kpOnly?: boolean }>;
  /** 내 소유 토큰이 이 화면에 있는지(없으면 GM이 놓아 줄 때까지 기다려야 한다) */
  hasToken?: boolean;
}

export interface GuideStep {
  key: "character" | "roll" | "handout" | "move" | "watch";
  done: boolean;
  title: string;
  hint: string;
}

export function playerGuideSteps(i: PlayerGuideInput): GuideStep[] {
  const handout: GuideStep = {
    key: "handout",
    done: i.handouts.some((h) => !h.kpOnly),
    title: "핸드아웃 받기",
    hint: "GM이 공개한 핸드아웃은 ‘핸드아웃’ 탭에 쌓여요.",
  };
  if (i.role === "spectator") {
    return [{ key: "watch", done: false, title: "관전 중이에요", hint: "보드와 핸드아웃을 볼 수 있어요." }, handout];
  }
  return [
    {
      key: "character",
      done: i.characters.some((c) => c.ownerId === i.userId),
      title: "내 캐릭터 준비하기",
      hint: "‘시트’ 탭에서 ‘캐릭터 만들기’로 바로 만들거나, 보관함 캐릭터를 불러와요.",
    },
    {
      key: "roll",
      done: i.rolls.some((r) => r.userId === i.userId),
      title: "굴림 해 보기",
      hint: "‘굴림’ 탭에 CC<=60, 1d100 같은 식을 넣거나 매크로·시트 판정 버튼을 눌러요. 세션이 시작되면 굴릴 수 있어요.",
    },
    handout,
    {
      key: "move",
      done: false,
      title: "토큰 움직이기",
      hint: i.hasToken === false ? "아직 내 토큰이 없어요. GM에게 요청하거나 기다려요. 세션이 시작되면 끌어서 옮길 수 있어요." : "세션이 시작되면 내 토큰을 끌어서 옮길 수 있어요.",
    },
  ];
}

/** 이 가이드를 지금 보여 줄지. 세션이 ACTIVE가 되거나 닫았으면 숨긴다. */
export function showPlayerGuide(i: { role: "kp" | "pl" | "spectator"; ready: boolean; sessionStatus: string; closed: boolean }): boolean {
  return i.ready && i.role !== "kp" && i.sessionStatus === "IDLE" && !i.closed;
}

const KEY = (roomId: string) => `coc-vtt:player-guide-closed:${roomId}`;

export function readGuideClosed(roomId: string, storage?: Pick<Storage, "getItem">): boolean {
  try {
    const s = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    return s?.getItem(KEY(roomId)) === "1";
  } catch {
    return false;
  }
}

export function writeGuideClosed(roomId: string, storage?: Pick<Storage, "setItem">): void {
  try {
    const s = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    s?.setItem(KEY(roomId), "1");
  } catch {
    /* 저장소가 없거나 막혀 있어도 이번 화면에서는 닫힌다 */
  }
}
