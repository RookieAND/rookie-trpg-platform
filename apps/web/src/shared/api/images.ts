import { API_URL } from "../config";
import { ApiError, authHeaders, type Caller } from "./http";
import { shrinkImage } from "./shrink-image";

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

/** 올릴 수 있는 이미지 형식(서버와 같다) */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** 형식이 맞지 않으면 안내 문구를, 괜찮으면 null을 돌려준다. 크기는 줄인 뒤에 uploadImage가 확인한다. */
export function imageFormatError(file: { type: string }): string | null {
  return (IMAGE_TYPES as readonly string[]).includes(file.type) ? null : "PNG, JPG, GIF, WEBP 이미지만 올릴 수 있어요.";
}

/** 끌어 놓거나 붙여 넣은 파일 중 첫 번째 이미지 파일. 이미지가 없으면 null. */
export function firstImageFile(files: ArrayLike<File> | null | undefined): File | null {
  if (!files) return null;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f && f.type.startsWith("image/")) return f;
  }
  return null;
}

/** 형식을 확인하고, 큰 그림은 줄여서 올린 뒤 이미지 id를 돌려준다. */
export async function uploadImageFile(me: Caller, file: File): Promise<string> {
  const bad = imageFormatError(file);
  if (bad) throw new ApiError(415, bad);
  return uploadImage(me, await shrinkImage(file));
}
