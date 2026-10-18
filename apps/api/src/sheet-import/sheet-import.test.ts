import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WsAdapter } from "@nestjs/platform-ws";
import { AppModule } from "../app.module";
import { SheetImportService } from "./application/sheet-import.service";
import type { SheetFetch } from "./domain/sheet-import";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aB";
const SHEET = `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`;
const EXPORT = `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`;
const csvRes = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "text/csv; charset=utf-8" }, ...init });
const redirect = (to: string, status = 307) => new Response(null, { status, headers: { location: to } });

/** 호출을 기록하고 준비한 응답을 차례로 돌려주는 가짜 fetch. 네트워크는 쓰지 않는다. */
function fakeFetch(...responses: Array<Response | (() => Promise<Response>)>) {
  const calls: Array<{ url: string; redirect: string; headers: Record<string, string> }> = [];
  const fn: SheetFetch = vi.fn(async (url, init) => {
    calls.push({ url, redirect: init.redirect, headers: init.headers });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return typeof next === "function" ? next() : next.clone();
  });
  return { fn, calls };
}

/** 몇 번 읽다가 끝나지 않는 스트림 */
function endlessBody(chunk: Uint8Array, onCancel: () => void) {
  return new ReadableStream<Uint8Array>({
    pull(ctl) {
      ctl.enqueue(chunk);
    },
    cancel: onCancel,
  });
}

describe("주소 허용 목록", () => {
  it("허용되지 않은 주소는 바깥으로 요청을 보내지 않는다", async () => {
    const f = fakeFetch(csvRes("x"));
    const svc = new SheetImportService(f.fn);
    for (const bad of [
      "http://docs.google.com/spreadsheets/d/" + ID,
      `https://docs.google.com.evil.example/spreadsheets/d/${ID}`,
      `https://docs.google.com@evil.example/spreadsheets/d/${ID}`,
      `https://docs.google.com:444/spreadsheets/d/${ID}`,
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/spreadsheets/d/" + ID,
      "file:///etc/passwd",
      "https://docs.google.com/document/d/" + ID,
      "",
      "그냥 글",
      undefined,
      42,
      { url: SHEET },
    ]) {
      expect(await svc.fetchCsv("u", bad), String(bad)).toEqual({ ok: false, code: "bad_url" });
    }
    expect(f.fn).not.toHaveBeenCalled();
  });

  it("편집 링크를 export?format=csv 주소로 바꿔 쿠키·인증 없이 요청한다", async () => {
    const f = fakeFetch(csvRes("a,b\r\n1,2\r\n"));
    const r = await new SheetImportService(f.fn).fetchCsv("u", `${SHEET}#gid=77`);
    expect(r).toEqual({ ok: true, csv: "a,b\r\n1,2\r\n" });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe(`${EXPORT}&gid=77`);
    expect(f.calls[0]!.redirect).toBe("manual");
    expect(Object.keys(f.calls[0]!.headers).sort()).toEqual(["accept", "user-agent"]);
  });

  it("웹에 게시한 주소는 pub?output=csv로 받는다", async () => {
    const f = fakeFetch(csvRes("a"));
    await new SheetImportService(f.fn).fetchCsv("u", `https://docs.google.com/spreadsheets/d/e/${ID}/pubhtml?gid=3`);
    expect(f.calls[0]!.url).toBe(`https://docs.google.com/spreadsheets/d/e/${ID}/pub?output=csv&gid=3`);
  });
});

describe("리디렉션", () => {
  it("같은 허용 목록 안의 리디렉션은 따라간다 (상대 주소 포함)", async () => {
    const f = fakeFetch(redirect(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&id=${ID}&gid=0`), redirect(`/spreadsheets/d/${ID}/export?format=csv&x=1`), csvRes("ok,1"));
    expect(await new SheetImportService(f.fn).fetchCsv("u", SHEET)).toEqual({ ok: true, csv: "ok,1" });
    expect(f.calls).toHaveLength(3);
    expect(f.calls.every((c) => c.url.startsWith("https://docs.google.com/spreadsheets/d/"))).toBe(true);
  });

  it("구글 로그인으로 가면 공유가 안 된 시트로 보고 따라가지 않는다", async () => {
    const f = fakeFetch(redirect("https://accounts.google.com/ServiceLogin?continue=x", 302));
    expect(await new SheetImportService(f.fn).fetchCsv("u", SHEET)).toEqual({ ok: false, code: "not_shared" });
    expect(f.calls).toHaveLength(1);
  });

  it("다른 호스트·사설 주소·http로 가는 리디렉션은 따라가지 않는다", async () => {
    for (const to of ["https://evil.example/x", "http://169.254.169.254/latest", "https://127.0.0.1/spreadsheets/d/" + ID + "/export", "http://docs.google.com/spreadsheets/d/" + ID + "/export", "https://doc-0k-9s-sheets.googleusercontent.com/export/abc"]) {
      const f = fakeFetch(redirect(to));
      expect(await new SheetImportService(f.fn).fetchCsv("u", SHEET), to).toEqual({ ok: false, code: "redirect" });
      expect(f.calls, to).toHaveLength(1);
    }
  });

  it("리디렉션 고리는 끊는다", async () => {
    const f = fakeFetch(redirect(EXPORT));
    expect(await new SheetImportService(f.fn, { maxRedirects: 3 }).fetchCsv("u", SHEET)).toEqual({ ok: false, code: "upstream" });
    expect(f.calls).toHaveLength(4);
  });

  it("Location이 없는 리디렉션은 실패다", async () => {
    const f = fakeFetch(new Response(null, { status: 302 }));
    expect(await new SheetImportService(f.fn).fetchCsv("u", SHEET)).toEqual({ ok: false, code: "upstream" });
  });
});

describe("크기 상한", () => {
  it("Content-Length가 상한을 넘으면 본문을 읽지 않는다", async () => {
    let read = false;
    const body = new ReadableStream({ pull() { read = true; } }, { highWaterMark: 0 });
    const f = fakeFetch(() => Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/csv", "content-length": "1000001" } })));
    expect(await new SheetImportService(f.fn).fetchCsv("u", SHEET)).toEqual({ ok: false, code: "too_large" });
    expect(read).toBe(false);
  });

  it("길이를 숨기고 끝없이 보내도 상한에서 끊고 스트림을 닫는다", async () => {
    let cancelled = false;
    const f = fakeFetch(() => Promise.resolve(new Response(endlessBody(new Uint8Array(64 * 1024).fill(97), () => (cancelled = true)), { status: 200, headers: { "content-type": "text/csv" } })));
    expect(await new SheetImportService(f.fn).fetchCsv("u", SHEET)).toEqual({ ok: false, code: "too_large" });
    expect(cancelled).toBe(true);
  });

  it("딱 상한까지는 받는다", async () => {
    const body = "a".repeat(1000);
    const f = fakeFetch(csvRes(body));
    expect(await new SheetImportService(f.fn, { maxBytes: 1000 }).fetchCsv("u", SHEET)).toEqual({ ok: true, csv: body });
    const over = fakeFetch(csvRes(body + "a"));
    expect(await new SheetImportService(over.fn, { maxBytes: 1000 }).fetchCsv("u", SHEET)).toEqual({ ok: false, code: "too_large" });
  });

  it("한글은 바이트로 세어 상한을 적용한다", async () => {
    const f = fakeFetch(csvRes("가".repeat(400))); // 1200바이트
    expect(await new SheetImportService(f.fn, { maxBytes: 1000 }).fetchCsv("u", SHEET)).toEqual({ ok: false, code: "too_large" });
  });
});

describe("시간 상한", () => {
  it("응답이 오지 않으면 시간 초과다", async () => {
    const f = fakeFetch(() => new Promise<Response>(() => {}));
    expect(await new SheetImportService(f.fn, { timeoutMs: 30 }).fetchCsv("u", SHEET)).toEqual({ ok: false, code: "timeout" });
  });

  it("본문이 멈춰도 시간 초과다", async () => {
    const stuck = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("a,b")); } });
    const f = fakeFetch(() => Promise.resolve(new Response(stuck, { status: 200, headers: { "content-type": "text/csv" } })));
    expect(await new SheetImportService(f.fn, { timeoutMs: 30 }).fetchCsv("u", SHEET)).toEqual({ ok: false, code: "timeout" });
  });

  it("fetch가 abort 오류를 던져도 시간 초과로 본다", async () => {
    const f = fakeFetch(() => new Promise<Response>((_, rej) => setTimeout(() => rej(new DOMException("aborted", "AbortError")), 50)));
    const r = await new SheetImportService(f.fn, { timeoutMs: 20 }).fetchCsv("u", SHEET);
    expect(r).toEqual({ ok: false, code: "timeout" });
  });
});

describe("응답 종류", () => {
  const run = (res: Response) => new SheetImportService(fakeFetch(res).fn).fetchCsv("u", SHEET);
  it("401·403은 공유 설정 문제로 알린다", async () => {
    expect(await run(new Response("no", { status: 403 }))).toEqual({ ok: false, code: "not_shared" });
    expect(await run(new Response("no", { status: 401 }))).toEqual({ ok: false, code: "not_shared" });
  });
  it("404·410은 시트를 못 찾은 것이다", async () => {
    expect(await run(new Response("", { status: 404 }))).toEqual({ ok: false, code: "not_found" });
    expect(await run(new Response("", { status: 410 }))).toEqual({ ok: false, code: "not_found" });
  });
  it("그 밖의 오류 상태는 upstream이다", async () => {
    expect(await run(new Response("", { status: 500 }))).toEqual({ ok: false, code: "upstream" });
  });
  it("HTML이 오면 CSV가 아니다 (로그인 화면 등)", async () => {
    expect(await run(new Response("<html></html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }))).toEqual({ ok: false, code: "not_shared" });
    expect(await run(csvRes("<!DOCTYPE html><html><body>login</body></html>"))).toEqual({ ok: false, code: "not_shared" });
  });
  it("빈 본문은 표가 아니다", async () => {
    expect(await run(csvRes("  \n"))).toEqual({ ok: false, code: "not_csv" });
  });
  it("fetch가 던지면 upstream이다", async () => {
    const f = fakeFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await new SheetImportService(f.fn).fetchCsv("u", SHEET)).toEqual({ ok: false, code: "upstream" });
  });
  it("UTF-8 한글과 BOM을 그대로 돌려준다", async () => {
    const r = await run(csvRes("﻿이름,윤서하\r\n"));
    expect(r).toEqual({ ok: true, csv: "﻿이름,윤서하\r\n" });
  });
});

describe("사용 횟수 제한", () => {
  it("사람마다 창 안에서 정해진 횟수까지만 바깥으로 나간다", async () => {
    let t = 0;
    const f = fakeFetch(csvRes("a"));
    const svc = new SheetImportService(f.fn, { maxPerWindow: 2, windowMs: 1000, now: () => t });
    expect((await svc.fetchCsv("a", SHEET)).ok).toBe(true);
    expect((await svc.fetchCsv("a", SHEET)).ok).toBe(true);
    expect(await svc.fetchCsv("a", SHEET)).toEqual({ ok: false, code: "rate_limited" });
    expect((await svc.fetchCsv("b", SHEET)).ok).toBe(true);
    t = 1500;
    expect((await svc.fetchCsv("a", SHEET)).ok).toBe(true);
    expect(f.fn).toHaveBeenCalledTimes(4);
  });
  it("잘못된 주소는 횟수를 쓰지 않는다", async () => {
    const svc = new SheetImportService(fakeFetch(csvRes("a")).fn, { maxPerWindow: 1 });
    for (let i = 0; i < 3; i++) await svc.fetchCsv("a", "nope");
    expect((await svc.fetchCsv("a", SHEET)).ok).toBe(true);
  });
});

describe("REST 엔드포인트", () => {
  let app: INestApplication;
  let base: string;
  afterEach(async () => {
    await app.close();
  });
  const boot = async (fn: SheetFetch) => {
    const ref = await Test.createTestingModule({ imports: [AppModule.register({ sheetImport: { fetch: fn } })] }).compile();
    app = ref.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  };
  const post = async (user: string | null, body: unknown) => {
    const res = await fetch(`${base}/sheet-import/google`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(user ? { "x-dev-user": encodeURIComponent(user) } : {}) },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };

  it("로그인 없이는 쓸 수 없고 바깥으로도 나가지 않는다", async () => {
    const f = fakeFetch(csvRes("a"));
    await boot(f.fn);
    expect((await post(null, { url: SHEET })).status).toBe(401);
    expect(f.fn).not.toHaveBeenCalled();
  });

  it("허용 목록 밖의 주소는 400이고 바깥으로 나가지 않는다", async () => {
    const f = fakeFetch(csvRes("a"));
    await boot(f.fn);
    const r = await post("하늘", { url: "https://evil.example/spreadsheets/d/" + ID });
    expect(r.status).toBe(400);
    expect(r.json.message).toContain("구글 시트 주소가 아니에요");
    expect((await post("하늘", {})).status).toBe(400);
    expect((await post("하늘", { url: ["x"] })).status).toBe(400);
    expect(f.fn).not.toHaveBeenCalled();
  });

  it("공유된 시트는 CSV 글을 돌려준다", async () => {
    const f = fakeFetch(csvRes("﻿이름,윤서하\r\n"));
    await boot(f.fn);
    const r = await post("하늘", { url: SHEET });
    expect(r).toEqual({ status: 200, json: { csv: "﻿이름,윤서하\r\n" } });
  });

  it("공유되지 않은 시트와 너무 큰 시트는 이유와 함께 거절한다", async () => {
    const f = fakeFetch(redirect("https://accounts.google.com/ServiceLogin", 302));
    await boot(f.fn);
    const r = await post("하늘", { url: SHEET });
    expect(r.status).toBe(422);
    expect(r.json.message).toContain("링크가 있는 모든 사용자");
    await app.close();
    const big = fakeFetch(() => Promise.resolve(new Response("x", { status: 200, headers: { "content-type": "text/csv", "content-length": "5000000" } })));
    await boot(big.fn);
    expect((await post("하늘", { url: SHEET })).status).toBe(413);
  });
});
