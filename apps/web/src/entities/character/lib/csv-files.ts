import { characterToCsv, sheetCsvTemplate, type SheetCsvSource } from "@coc-vtt/shared";
import { downloadText } from "@/shared/lib";

const MIME = "text/csv;charset=utf-8";
const safeName = (name: string) => name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 40) || "캐릭터";

/** 캐릭터를 CSV 파일로 내려받는다(UTF-8 BOM 포함, 엑셀에서 한글이 깨지지 않는다). */
export function downloadCharacterCsv(src: SheetCsvSource) {
  downloadText(`${safeName(src.name)}.csv`, characterToCsv(src), MIME);
}

/** 가져오기 양식(빈 시트)을 내려받는다. */
export function downloadSheetTemplate() {
  downloadText("캐릭터-양식.csv", sheetCsvTemplate(), MIME);
}
