"use client";

/** 보드 옆의 작은 되돌리기 버튼(GM). 기록이 없으면 서버가 오류 토스트로 알려 준다. inline이면 떠 있지 않고 놓인 자리에 그린다. */
export function UndoButton({ onUndo, inline = false }: { onUndo: () => void; inline?: boolean }) {
  const btn = (
    <button type="button" className={`btn${inline ? "" : " sm"}`} data-testid="undo-btn" title="가장 최근 변경을 되돌려요 (Ctrl+Z)" onClick={onUndo}>
      ↶ 되돌리기
    </button>
  );
  return inline ? btn : <div className="undo-ctl">{btn}</div>;
}
