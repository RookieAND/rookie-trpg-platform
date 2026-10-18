import { http, type Caller } from "@/shared/api";

/** 링크 공유된 구글 시트를 서버가 CSV로 한 번 받아 준다(읽기만). 주소 검사와 크기·시간 상한은 서버에서 한다. */
export const fetchGoogleSheetCsv = (me: Caller, url: string) => http<{ csv: string }>(me, "POST", "/sheet-import/google", { url }).then((r) => r.csv);
