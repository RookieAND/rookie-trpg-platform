"use client";
import type { Handout } from "@coc-vtt/shared";
import { imageUrl } from "@/shared/api";
import { Dialog } from "@/shared/ui";

/** GM이 "펼쳐 보이기"를 눌렀을 때 모두의 화면 가운데에 뜨는 핸드아웃 */
export function HandoutSpotlight({ handout, onClose }: { handout: Handout; onClose: () => void }) {
  return (
    <Dialog label="핸드아웃" onClose={onClose} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 20, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", padding: 24 }}>
      <article className="card" onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "80vh", overflow: "auto", gap: 12, boxShadow: "0 24px 64px rgba(0,0,0,.6)" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{handout.title}</h2>
        {handout.image && <img src={imageUrl(handout.image)} alt={`${handout.title} 이미지`} style={{ maxWidth: "100%", maxHeight: "50vh", objectFit: "contain", borderRadius: 6, justifySelf: "center" }} />}
        <div style={{ whiteSpace: "pre-wrap" }}>{handout.body || <span style={{ color: "var(--muted)" }}>내용이 없어요.</span>}</div>
        <div style={{ textAlign: "right" }}>
          <button className="btn primary" onClick={onClose}>닫기</button>
        </div>
      </article>
    </Dialog>
  );
}
