"use client";
import { imageUrl } from "../api";

/**
 * 이미지 고르기 목록. 새 파일을 올리거나, 이 룸에서 이미 올린 이미지(최근 것부터)를 다시 고른다.
 * 위치를 잡지 않고 제 자리에 펼쳐지므로 메뉴·패널·떠 있는 상자 어디에든 넣을 수 있다.
 */
export function ImagePicker({ ids, current, busy, error, onUpload, onPick, onClose, float }: { float?: boolean; ids: string[]; current?: string | null; busy?: boolean; error?: string | null; onUpload: () => void; onPick: (id: string) => void; onClose?: () => void }) {
  return (
    <div
      className={`img-picker${float ? " float" : ""}`}
      role="group"
      aria-label="이미지 고르기"
      data-overlay=""
      data-testid="image-picker"
      onKeyDown={(e) => {
        if (e.key === "Escape" && onClose) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="img-picker-head">
        <strong>이미지 고르기</strong>
        {onClose && <button type="button" className="toast-x" aria-label="이미지 고르기 닫기" onClick={onClose}>×</button>}
      </div>
      <button type="button" className="btn sm" data-testid="image-picker-upload" disabled={busy} onClick={onUpload}>
        {busy ? "올리는 중…" : "새 파일 올리기"}
      </button>
      {ids.length > 0 ? (
        <>
          <div className="img-picker-sub">이 룸에서 쓴 이미지</div>
          <div className="img-grid">
            {ids.map((id) => (
              <button key={id} type="button" className="img-thumb" aria-label="이 이미지 쓰기" aria-pressed={id === current} data-testid="image-thumb" onClick={() => onPick(id)}>
                <img src={imageUrl(id)} alt="" loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="img-picker-sub">아직 올린 이미지가 없어요.</div>
      )}
      {error && <span role="alert" style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span>}
    </div>
  );
}
