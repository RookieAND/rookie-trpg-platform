"use client";
import { useState } from "react";
import type { CharacterInput } from "@coc-vtt/shared";
import { createCharacter, type VaultCharacter } from "@/entities/character";
import type { Identity } from "@/entities/user";
import { CharacterWizard } from "@/features/edit-character";
import { useOccupations } from "@/features/manage-occupations";
import { ApiError } from "@/shared/api";

/**
 * 생성 마법사를 보관함 저장까지 묶은 조각. 로비의 ‘내 캐릭터’와 룸 안의 ‘캐릭터 만들기’가 같은 것을 쓴다.
 * 마법사 끝에서 보관함에 저장하고, 저장된 캐릭터를 onCreated로 넘긴다(룸에서는 거기서 룸에 올린다).
 */
export function CharacterCreator({ me, onCreated, onCancel }: { me: Identity; onCreated: (c: VaultCharacter) => void | Promise<void>; onCancel: () => void }) {
  const jobs = useOccupations(me);
  const [error, setError] = useState<string | null>(null);

  const save = async (data: CharacterInput) => {
    setError(null);
    let created: VaultCharacter;
    try {
      created = await createCharacter(me, data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했어요. 잠시 뒤에 다시 해 주세요.");
      return;
    }
    await onCreated(created);
  };

  return (
    <div className="creator" data-testid="character-creator">
      {error && <div className="err" role="alert" data-testid="creator-error">{error}</div>}
      <CharacterWizard occupations={jobs.occupations} onSubmit={save} onCancel={onCancel} />
    </div>
  );
}
