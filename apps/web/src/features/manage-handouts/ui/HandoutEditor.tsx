"use client";
import { useState } from "react";
import type { Member, Visibility } from "@coc-vtt/shared";
import { imageUrl, type Caller } from "@/shared/api";
import { ImageUploadButton } from "@/shared/ui";

export interface HandoutDraft {
  title: string;
  body: string;
  /** null이면 이미지를 뗀다 */
  image: string | null;
  visibleTo: Visibility;
}

type Mode = "gm" | "all" | "pick";

/** KP가 핸드아웃을 쓰고 보여 줄 대상을 정한다. 초안(KP만)으로 두면 아무에게도 안 보인다. */
export function HandoutEditor({ me, initial, players, onSave, onCancel }: { me: Caller; initial?: Partial<HandoutDraft>; players: Member[]; onSave: (d: HandoutDraft) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [image, setImage] = useState<string | null>(initial?.image ?? null);
  const [mode, setMode] = useState<Mode>(Array.isArray(initial?.visibleTo) ? "pick" : (initial?.visibleTo ?? "gm"));
  const [picked, setPicked] = useState<string[]>(Array.isArray(initial?.visibleTo) ? initial.visibleTo : []);

  const visibleTo: Visibility = mode === "pick" ? picked : mode;
  const valid = title.trim().length > 0 && (mode !== "pick" || picked.length > 0);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <input className="input" aria-label="핸드아웃 제목" placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input" style={{ height: 120, padding: 12 }} aria-label="핸드아웃 내용" placeholder="내용" value={body} onChange={(e) => setBody(e.target.value)} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {image && <img src={imageUrl(image)} alt="핸드아웃 이미지 미리보기" style={{ height: 56, borderRadius: 6, border: "1px solid var(--border)" }} />}
        <ImageUploadButton me={me} label={image ? "이미지 바꾸기" : "이미지 넣기"} onUploaded={setImage} />
        {image && <button type="button" className="btn" style={{ height: 28 }} onClick={() => setImage(null)}>이미지 떼기</button>}
      </div>
      <select className="input" aria-label="공개 범위" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
        <option value="gm">초안 (KP만 보기)</option>
        <option value="all">전원에게 공개</option>
        <option value="pick">선택한 PL에게만</option>
      </select>
      {mode === "pick" &&
        (players.length === 0 ? (
          <span style={{ color: "var(--muted)" }}>아직 PL이 없어요.</span>
        ) : (
          players.map((p) => (
            <label key={p.userId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={picked.includes(p.userId)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.userId] : picked.filter((x) => x !== p.userId))} style={{ accentColor: "#5fd3a4" }} />
              {p.name}
            </label>
          ))
        ))}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>취소</button>
        <button className="btn primary" disabled={!valid} onClick={() => onSave({ title: title.trim(), body, image, visibleTo })}>저장</button>
      </div>
    </div>
  );
}
