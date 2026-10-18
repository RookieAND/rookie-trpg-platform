"use client";

/** 보드 옆의 작은 되돌리기 버튼(KP). 기록이 없으면 서버가 오류 토스트로 알려 준다. */
export function UndoButton({ onUndo }: { onUndo: () => void }) {
  return (
    <div className="undo-ctl">
      <button type="button" className="btn sm" data-testid="undo-btn" title="가장 최근 변경을 되돌려요 (Ctrl+Z)" onClick={onUndo}>
        ↶ 되돌리기
      </button>
    </div>
  );
}
