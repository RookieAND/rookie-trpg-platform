import type { CharacterInput } from "@coc-vtt/shared";
import { http, type Caller } from "@/shared/api";
import type { VaultCharacter } from "../model/types";

export const listCharacters = (me: Caller) => http<VaultCharacter[]>(me, "GET", "/characters");
export const createCharacter = (me: Caller, data: CharacterInput) => http<VaultCharacter>(me, "POST", "/characters", data);
export const updateCharacter = (me: Caller, id: string, data: CharacterInput) => http<VaultCharacter>(me, "PUT", `/characters/${encodeURIComponent(id)}`, data);
export const deleteCharacter = (me: Caller, id: string) => http<null>(me, "DELETE", `/characters/${encodeURIComponent(id)}`);
