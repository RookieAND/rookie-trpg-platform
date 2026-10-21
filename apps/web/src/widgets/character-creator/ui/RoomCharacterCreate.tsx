"use client";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import type { ClientCommand } from "@coc-vtt/shared";
import { toRoomCharacter } from "@/entities/character";
import type { Identity } from "@/entities/user";
import { Dialog } from "@/shared/ui";
import { CharacterCreator } from "./CharacterCreator";

/**
 * 룸 안에서 캐릭터를 만든다. 시트 탭에서 버튼을 누르면 마법사가 창으로 열리고,
 * 끝나면 보관함에 저장하고 이 룸에도 올린다(룸을 떠나지 않는다).
 */
export function RoomCharacterCreate({ me, send, disabled, label = "캐릭터 만들기", onDone }: { me: Identity; send: (c: ClientCommand) => unknown; disabled?: boolean; label?: string; onDone?: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button type="button" className="btn primary" data-testid="create-in-room" disabled={disabled} onClick={() => (setError(null), setOpen(true))}><UserPlus aria-hidden />{label}</button>
      {open && (
        <Dialog label="캐릭터 만들기" onClose={() => setOpen(false)} className="modal-veil" data-testid="create-dialog">
          <div className="modal-card">
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <h2 style={{ margin: 0, fontSize: 15 }}>캐릭터 만들기</h2>
              <button type="button" className="btn" aria-label="창 닫기" onClick={() => setOpen(false)}>닫기</button>
            </div>
            <p className="why" style={{ margin: 0 }}>다 만들면 내 보관함에 저장되고 이 룸에 바로 올라가요.</p>
            {error && <div className="err" role="alert">{error}</div>}
            <CharacterCreator
              me={me}
              onCancel={() => setOpen(false)}
              onCreated={(c) => {
                if (send({ type: "character.add", data: toRoomCharacter(c) }) === false) {
                  setError("보관함에는 저장했어요. 룸에는 아직 올리지 못했어요. 연결이 돌아오면 시트 탭의 ‘불러오기’에서 올려 주세요.");
                  return;
                }
                setOpen(false);
                onDone?.(`‘${c.name}’을 만들어 룸에 올렸어요.`);
              }}
            />
          </div>
        </Dialog>
      )}
    </>
  );
}
