"use client";
import { useState } from "react";
import type { Member, Visibility } from "@coc-vtt/shared";
import { firstImageFile, imageUrl, type Caller } from "@/shared/api";
import { ImageUploadButton, useFileDrop, useImageUpload } from "@/shared/ui";

export interface HandoutDraft {
  title: string;
  body: string;
  /** null이면 이미지를 뗀다 */
  image: string | null;
  visibleTo: Visibility;
  /** GM 전용 노트면 공개 범위를 바꿀 수 없다 */
  kpOnly: boolean;
}

type Mode = "note" | "gm" | "all" | "pick";

/** GM이 핸드아웃을 쓰고 보여 줄 대상을 정한다. 초안(GM만)으로 두면 아무에게도 안 보인다. */
export function HandoutEditor({ me, initial, players, onSave, onCancel }: { me: Caller; initial?: Partial<HandoutDraft>; players: Member[]; onSave: (d: HandoutDraft) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [image, setImage] = useState<string | null>(initial?.image ?? null);
  const [mode, setMode] = useState<Mode>(initial?.kpOnly ? "note" : Array.isArray(initial?.visibleTo) ? "pick" : (initial?.visibleTo ?? "gm"));
  const [picked, setPicked] = useState<string[]>(Array.isArray(initial?.visibleTo) ? initial.visibleTo : []);

  // 이미지 칸에 파일을 끌어다 놓아도 넣을 수 있다.
  const drop = useImageUpload(me, setImage);
  // 이미지가 아닌 파일이면 올리기 단계에서 형식 안내가 뜬다.
  const zone = useFileDrop((files) => void drop.upload(firstImageFile(files) ?? files[0]));

  const visibleTo: Visibility = mode === "pick" ? picked : mode === "note" ? "gm" : mode;
  const valid = title.trim().length > 0 && (mode !== "pick" || picked.length > 0);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <input className="input" aria-label="핸드아웃 제목" placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input" style={{ height: 120 }} aria-label="핸드아웃 내용" placeholder="내용" value={body} onChange={(e) => setBody(e.target.value)} />
      <div className={`img-drop${zone.over ? " over" : ""}`} data-testid="handout-image-drop" {...zone.props}>
        {image && <img src={imageUrl(image)} alt="핸드아웃 이미지 미리보기" style={{ height: 56, borderRadius: 6, border: "1px solid var(--line-2)" }} />}
        <ImageUploadButton me={me} label={image ? "이미지 바꾸기" : "이미지 넣기"} current={image} onUploaded={setImage} />
        {image && <button type="button" className="btn" onClick={() => setImage(null)}>이미지 떼기</button>}
        {!image && <span className="img-drop-hint">{drop.busy ? "올리는 중…" : "여기에 이미지를 끌어다 놓아도 돼요"}</span>}
        {drop.error && <span role="alert" style={{ color: "var(--danger)", fontSize: 12 }}>{drop.error}</span>}
      </div>
      <select className="input" aria-label="공개 범위" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
        <option value="note">GM 전용 노트 (공개할 수 없어요)</option>
        <option value="gm">초안 (나중에 공개할 수 있어요)</option>
        <option value="all">전원에게 공개</option>
        <option value="pick">선택한 PL에게만</option>
      </select>
      {mode === "pick" &&
        (players.length === 0 ? (
          <span style={{ color: "var(--muted)" }}>아직 PL이 없어요.</span>
        ) : (
          players.map((p) => (
            <label key={p.userId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={picked.includes(p.userId)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.userId] : picked.filter((x) => x !== p.userId))} style={{ accentColor: "#7c86f7" }} />
              {p.name}
            </label>
          ))
        ))}
      <div className="btn-row" style={{ justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onCancel}>취소</button>
        <button className="btn primary" disabled={!valid} onClick={() => onSave({ title: title.trim(), body, image, visibleTo, kpOnly: mode === "note" })}>저장</button>
      </div>
    </div>
  );
}
