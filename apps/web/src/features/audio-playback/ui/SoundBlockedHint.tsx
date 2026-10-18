"use client";

/** 브라우저가 소리를 막고 있을 때 헤더에 띄우는 작은 안내. 누르거나 화면 아무 곳이나 한 번 누르면 풀리고 사라진다. */
export function SoundBlockedHint({ blocked, onUnlock }: { blocked: boolean; onUnlock: () => void }) {
  if (!blocked) return null;
  return (
    <button type="button" className="badge paused sound-hint" role="status" data-testid="sound-blocked-hint" onClick={onUnlock}>
      소리가 막혀 있어요 · 한 번 눌러 주세요
    </button>
  );
}
