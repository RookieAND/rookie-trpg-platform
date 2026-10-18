import { describe, expect, it } from "vitest";
import { decodeCsvBytes } from "./csv-bytes";

describe("decodeCsvBytes", () => {
  it("UTF-8은 BOM이 있어도 그대로 읽는다", () => {
    const bytes = new TextEncoder().encode("﻿이름,윤서하");
    const r = decodeCsvBytes(bytes);
    expect(r.encoding).toBe("utf-8");
    expect(r.text.endsWith("이름,윤서하")).toBe(true);
  });
  it("엑셀이 EUC-KR로 저장한 파일은 깨지지 않게 다시 읽는다", () => {
    // "한글" = C7 D1 B1 DB (EUC-KR)
    const r = decodeCsvBytes(Uint8Array.from([0xc7, 0xd1, 0xb1, 0xdb, 0x2c, 0x31]));
    expect(r).toEqual({ text: "한글,1", encoding: "euc-kr" });
  });
});
