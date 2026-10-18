/**
 * 파일 바이트를 글로 읽는다. 엑셀의 "CSV(쉼표로 분리)"는 UTF-8이 아니라 한글 윈도우 인코딩(EUC-KR/CP949)으로
 * 저장되므로, UTF-8로 읽다가 깨지면 EUC-KR로 다시 읽는다.
 */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: "utf-8" | "euc-kr" } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "euc-kr" };
  }
}
