/** 전투에서 내 캐릭터 차례일 때 보드 위에 뜨는 표시. */
/** `lowered`: 위쪽에 장면 막대가 있는 KP 화면에서는 아래쪽(도구 막대 위)에 둔다. */
export function MyTurnBadge({ round, lowered, onOpen }: { round: number; lowered?: boolean; onOpen: () => void }) {
  return (
    <button type="button" className={`turn-badge${lowered ? " low" : ""}`} data-testid="my-turn" onClick={onOpen} title="전투 탭 열기">
      <span aria-hidden>▶</span> 내 차례예요 <span className="turn-sub">{round}라운드</span>
    </button>
  );
}
