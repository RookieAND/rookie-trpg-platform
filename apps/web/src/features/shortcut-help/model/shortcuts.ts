export interface ShortcutItem {
  /** 한 줄에 함께 보여 줄 키 조합들(‘또는’으로 이어진다) */
  keys: string[];
  text: string;
}
export interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

/** 이 화면에서 쓸 수 있는 단축키 목록. mod는 이 기기의 수정 키 이름(⌘ 또는 Ctrl). GM이 아니면 GM 전용 키는 뺀다. */
export function shortcutGroups({ isKp, mod }: { isKp: boolean; mod: string }): ShortcutGroup[] {
  const groups: ShortcutGroup[] = [
    {
      title: "토큰",
      items: [
        { keys: ["방향키"], text: "고른 토큰을 20만큼 움직여요 (격자 맞춤을 켜면 한 칸씩)" },
        { keys: ["Shift+방향키"], text: "5만큼 잘게 움직여요" },
        { keys: ["Tab", "Shift+Tab"], text: "다음·이전 토큰을 골라요" },
        { keys: ["Esc"], text: "선택을 풀어요 (자가 켜져 있으면 자를 꺼요)" },
        { keys: ["P"], text: "고른 토큰의 자리를 모두에게 가리켜요" },
      ],
    },
    {
      title: "보드 보기",
      items: [
        { keys: ["+", "-"], text: "확대·축소해요" },
        { keys: ["0"], text: "보드 전체가 보이게 맞춰요" },
        { keys: ["마우스 휠", "Ctrl(Cmd) + 휠"], text: "커서 자리를 기준으로 확대·축소해요" },
        { keys: ["빈 곳 끌기"], text: "보기를 옮겨요 (터치는 두 손가락으로 모으고 벌려 확대해요)" },
        { keys: ["Alt+클릭", "더블클릭", "길게 누르기"], text: "그 자리를 모두에게 가리켜요" },
      ],
    },
  ];
  if (isKp) {
    groups.push(
      {
        title: "GM 편집",
        items: [
          { keys: ["Delete", "Backspace"], text: "고른 토큰·소품을 지워요" },
          { keys: [`${mod}+Z`], text: "가장 최근 변경을 되돌려요" },
          { keys: [`${mod}+D`], text: "고른 것을 복제해요" },
        ],
      },
      {
        title: "연출",
        items: [
          { keys: ["1 ~ 9"], text: "연출 칸에 등록한 동작을 실행해요. 진행 중 장면 전환은 3초 안에 취소할 수 있어요" },
          { keys: [`${mod}+K`], text: "명령어 검색을 열어요" },
        ],
      },
    );
  }
  groups.push({ title: "도움말", items: [{ keys: ["?"], text: "이 창을 열어요" }] });
  return groups;
}

/** 이 키 입력이 도움말을 여는 키인가(?, 한국어·영어 자판 모두 key가 "?"). 글을 쓰는 중이면 아니다. */
export function isHelpKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: EventTarget | null }): boolean {
  if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = t?.tagName?.toUpperCase();
  return !(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable);
}
