/**
 * 시트의 글칸(소지품·인물 배경·메모)은 다른 쪽의 변경(HP 조정, GM의 수정 등)이 도착해도
 * 지금 입력 중인 글을 덮어쓰면 안 된다. 입력 중에는 받은 값을 미뤄 두고, 칸을 벗어날 때 합친다.
 */
export interface BlurInput {
  /** 입력을 시작할 때 서버에 있던 글 */
  base: string;
  /** 지금 칸에 적힌 글 */
  local: string;
  /** 입력하는 동안 마지막으로 받은 서버의 글 */
  remote: string;
}

export interface BlurResult {
  /** 서버로 보낼 글. 보낼 게 없으면 null */
  commit: string | null;
  /** 칸에 보여 줄 글 */
  next: string;
}

/** 칸을 벗어날 때의 합치기. 내가 안 고쳤으면 받은 값을 따르고, 고쳤으면 내 글을 저장한다(둘 다 고쳤으면 내 글이 이긴다). */
export function resolveOnBlur({ base, local, remote }: BlurInput): BlurResult {
  if (local === base) return { commit: null, next: remote };
  if (local === remote) return { commit: null, next: local };
  return { commit: local, next: local };
}
