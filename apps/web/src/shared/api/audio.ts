import { API_URL } from "../config";
import { ApiError, authHeaders, type Caller } from "./http";

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** 업로드한 음원을 받아 올 주소 */
export const audioUrl = (id: string) => `${API_URL}/audio/${id}`;

/** 음원을 올리고 id를 돌려받는다. 형식과 크기는 서버가 다시 확인한다. */
export async function uploadAudio(me: Caller, file: File): Promise<string> {
  if (file.size > MAX_AUDIO_BYTES) throw new ApiError(413, "음원은 10MB까지 올릴 수 있어요.");
  const res = await fetch(`${API_URL}/audio`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream", ...authHeaders(me) },
    body: file,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.message ?? "음원을 올리지 못했어요.");
  return json.id as string;
}
