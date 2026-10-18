/**
 * 구글 시트 주소 허용 목록. 서버가 대신 가져올 수 있는 주소는 아래 두 모양뿐이다.
 *   https://docs.google.com/spreadsheets/d/<id>/...            (링크 공유된 시트)
 *   https://docs.google.com/spreadsheets/d/e/<id>/pub...       (웹에 게시된 시트)
 * 호스트는 docs.google.com 하나, https만, 포트·계정 정보 없음. 그 밖의 주소는 모두 거절한다.
 */

export const GOOGLE_SHEET_HOST = "docs.google.com";
const MAX_URL_LENGTH = 2048;

export interface GoogleSheetRef {
  /** "d": 공유 링크, "pub": 웹에 게시 */
  kind: "d" | "pub";
  id: string;
  /** 시트 탭 번호. 없으면 첫 탭 */
  gid?: string;
}

const ID = /^[A-Za-z0-9_-]{20,200}$/;
const GID = /^\d{1,12}$/;

function plainHttps(u: URL): boolean {
  return u.protocol === "https:" && u.hostname === GOOGLE_SHEET_HOST && u.port === "" && u.username === "" && u.password === "";
}

/** 사용자가 붙여 넣은 주소에서 시트 id와 탭 번호를 뽑는다. 허용 목록에 안 맞으면 null. */
export function parseGoogleSheetUrl(input: string): GoogleSheetRef | null {
  const raw = input.trim();
  if (raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!plainHttps(u)) return null;
  const pub = /^\/spreadsheets\/d\/e\/([^/]+)(?:\/|$)/.exec(u.pathname);
  const shared = /^\/spreadsheets\/d\/([^/]+)(?:\/|$)/.exec(u.pathname);
  const kind = pub ? "pub" : shared ? "d" : null;
  const id = pub?.[1] ?? shared?.[1];
  if (!kind || !id || !ID.test(id)) return null;
  // 탭 번호는 ?gid=0 또는 #gid=0 에 있다.
  const fromHash = /(?:^#|&)gid=([^&]*)/.exec(u.hash)?.[1];
  const gid = u.searchParams.get("gid") ?? fromHash;
  if (gid !== undefined && gid !== null && gid !== "") {
    if (!GID.test(gid)) return null;
    return { kind, id, gid };
  }
  return { kind, id };
}

/** 서버가 실제로 가져올 CSV 주소 */
export function googleSheetCsvUrl(ref: GoogleSheetRef): string {
  const gid = ref.gid !== undefined ? `&gid=${ref.gid}` : "";
  return ref.kind === "d"
    ? `https://${GOOGLE_SHEET_HOST}/spreadsheets/d/${ref.id}/export?format=csv${gid}`
    : `https://${GOOGLE_SHEET_HOST}/spreadsheets/d/e/${ref.id}/pub?output=csv${gid}`;
}

/** 리디렉션 목적지가 허용 목록 안인가(같은 호스트의 내보내기·게시 주소만). */
export function isAllowedGoogleCsvTarget(location: string): boolean {
  let u: URL;
  try {
    u = new URL(location);
  } catch {
    return false;
  }
  if (!plainHttps(u)) return false;
  return /^\/spreadsheets\/d\/(?:e\/)?[A-Za-z0-9_-]{20,200}\/(?:export|pub)$/.test(u.pathname);
}
