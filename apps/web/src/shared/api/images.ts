import { API_URL } from "../config";
import { ApiError, authHeaders, type Caller } from "./http";

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** 업로드한 이미지를 보여 줄 주소 */
export const imageUrl = (id: string) => `${API_URL}/images/${id}`;

/** 이미지를 올리고 id를 돌려받는다. 형식과 크기는 서버가 다시 확인한다. */
export async function uploadImage(me: Caller, file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(413, "이미지는 3MB까지 올릴 수 있어요.");
  const res = await fetch(`${API_URL}/images`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream", ...authHeaders(me) },
    body: file,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.message ?? "이미지를 올리지 못했어요.");
  return json.id as string;
}
