import { describe, expect, it } from "vitest";
import { googleSheetCsvUrl, isAllowedGoogleCsvTarget, parseGoogleSheetUrl } from "./google-sheet-url";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aB";

describe("parseGoogleSheetUrl", () => {
  it("편집 링크에서 id와 탭 번호를 뽑는다", () => {
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)).toEqual({ kind: "d", id: ID });
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123456`)).toEqual({ kind: "d", id: ID, gid: "123456" });
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=7#gid=9`)).toEqual({ kind: "d", id: ID, gid: "7" });
    expect(parseGoogleSheetUrl(`  https://docs.google.com/spreadsheets/d/${ID}  `)).toEqual({ kind: "d", id: ID });
  });

  it("웹에 게시한 주소도 받는다", () => {
    const pub = "2PACX-1vQabcdefghijklmnopqrstuvwxyz0123456789";
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/e/${pub}/pubhtml?gid=5&single=true`)).toEqual({ kind: "pub", id: pub, gid: "5" });
  });

  it("다른 호스트·http·포트·계정 정보·비슷한 호스트를 모두 거절한다", () => {
    const path = `/spreadsheets/d/${ID}/edit`;
    for (const bad of [
      `http://docs.google.com${path}`,
      `https://docs.google.com:8443${path}`,
      `https://user:pw@docs.google.com${path}`,
      `https://docs.google.com@evil.example${path}`,
      `https://evil.example/docs.google.com${path}`,
      `https://docs.google.com.evil.example${path}`,
      `https://evildocs.google.com${path}`,
      `https://sub.docs.google.com${path}`,
      `https://drive.google.com${path}`,
      `https://docs.google.com\\@evil.example${path}`,
      `https://127.0.0.1${path}`,
      `https://localhost${path}`,
      `https://[::1]${path}`,
      `https://169.254.169.254/latest/meta-data/`,
      `file:///etc/passwd`,
      `javascript:alert(1)`,
      `ftp://docs.google.com${path}`,
    ]) expect(parseGoogleSheetUrl(bad), bad).toBeNull();
  });

  it("스프레드시트 경로가 아니거나 id·탭 번호 모양이 틀리면 거절한다", () => {
    for (const bad of [
      "https://docs.google.com/document/d/" + ID + "/edit",
      "https://docs.google.com/spreadsheets/",
      "https://docs.google.com/spreadsheets/d/short/edit",
      `https://docs.google.com/spreadsheets/d/${ID}%2F..%2F..%2Fx/edit`,
      `https://docs.google.com/spreadsheets/d/..%2f..%2f/edit`,
      `https://docs.google.com/spreadsheets/d/e/short/pub`,
      `https://docs.google.com/spreadsheets/d/${ID}/edit?gid=abc`,
      `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=1;rm`,
      "",
      "   ",
      "문자열",
      "https://docs.google.com/spreadsheets/d/" + ID + "/" + "a".repeat(3000),
    ]) expect(parseGoogleSheetUrl(bad), bad.slice(0, 80)).toBeNull();
  });
});

describe("googleSheetCsvUrl", () => {
  it("공유 링크는 export?format=csv, 게시 주소는 pub?output=csv로 만든다", () => {
    expect(googleSheetCsvUrl({ kind: "d", id: ID })).toBe(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`);
    expect(googleSheetCsvUrl({ kind: "d", id: ID, gid: "42" })).toBe(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=42`);
    expect(googleSheetCsvUrl({ kind: "pub", id: ID, gid: "0" })).toBe(`https://docs.google.com/spreadsheets/d/e/${ID}/pub?output=csv&gid=0`);
  });
  it("만든 주소는 다시 허용 목록을 통과한다", () => {
    expect(isAllowedGoogleCsvTarget(googleSheetCsvUrl({ kind: "d", id: ID, gid: "1" }))).toBe(true);
    expect(isAllowedGoogleCsvTarget(googleSheetCsvUrl({ kind: "pub", id: ID }))).toBe(true);
  });
});

describe("isAllowedGoogleCsvTarget", () => {
  it("같은 호스트의 내보내기·게시 주소만 따라간다", () => {
    expect(isAllowedGoogleCsvTarget(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&id=${ID}`)).toBe(true);
    expect(isAllowedGoogleCsvTarget("https://accounts.google.com/ServiceLogin?continue=x")).toBe(false);
    expect(isAllowedGoogleCsvTarget("https://doc-0k-9s-sheets.googleusercontent.com/export/abc")).toBe(false);
    expect(isAllowedGoogleCsvTarget(`http://docs.google.com/spreadsheets/d/${ID}/export`)).toBe(false);
    expect(isAllowedGoogleCsvTarget(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toBe(false);
    expect(isAllowedGoogleCsvTarget("/spreadsheets/d/x/export")).toBe(false);
    expect(isAllowedGoogleCsvTarget("https://127.0.0.1/spreadsheets/d/" + ID + "/export")).toBe(false);
  });
});
