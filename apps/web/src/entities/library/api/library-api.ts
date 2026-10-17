import type { Library } from "@coc-vtt/shared";
import { http, type Caller } from "@/shared/api";

export const getLibrary = (me: Caller) => http<Library>(me, "GET", "/library");
export const putLibrary = (me: Caller, library: Library) => http<Library>(me, "PUT", "/library", library);
