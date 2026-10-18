// 운영 빌드 스모크. 빌드된 API(`node apps/api/dist/main.js`)를 production 모드로 띄워 실제로 쓰는 길을 확인한다.
//   pnpm build:api && node scripts/smoke-prod.mjs
//   WEB_URL=http://localhost:3961 node scripts/smoke-prod.mjs   (이미 떠 있는 `next start`도 함께 확인)
// 확인: health/ready, 개발용 인증 차단, HS256·JWKS(ES256) 로그인, 룸 만들기, ws 접속(snapshot), 이미지 올리기,
//       SIGTERM 때 ws가 1012로 닫히고 룸이 저장되는지, 다시 띄웠을 때 룸이 남아 있는지.
import { spawn } from "node:child_process";
import { createHmac, createSign, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const MAIN = join(root, "apps/api/dist/main.js");
if (!existsSync(MAIN)) {
  console.error("apps/api/dist/main.js가 없어요. 먼저 `pnpm build:api`를 실행하세요.");
  process.exit(2);
}
const WEB_URL = process.env.WEB_URL?.replace(/\/$/, "");

let failures = 0;
const ok = (cond, label, extra = "") => {
  console.log(`${cond ? "  ok " : "FAIL "} ${label}${!cond && extra ? ` — ${extra}` : ""}`);
  if (!cond) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

// 로컬 프록시 설정을 타지 않는 fetch (node의 fetch는 환경변수 프록시를 안 쓰지만 명시해 둔다)
const get = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) });

async function freePort() {
  return await new Promise((res) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

function startApi(env) {
  const child = spawn(process.execPath, [MAIN], { env: { PATH: process.env.PATH, NODE_ENV: "production", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const exited = new Promise((res) => child.on("exit", (code, sig) => res({ code, sig })));
  return { child, exited, log: () => out };
}

async function waitFor(url, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await get(url)).ok) return true;
    } catch {}
    await sleep(150);
  }
  return false;
}

const hsToken = (secret, claims) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64(claims);
  return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
};
const esToken = (priv, kid, claims) => {
  const h = b64({ alg: "ES256", typ: "JWT", kid });
  const p = b64(claims);
  const sig = cryptoSign("sha256", Buffer.from(`${h}.${p}`), { key: priv, dsaEncoding: "ieee-p1363" });
  return `${h}.${p}.${sig.toString("base64url")}`;
};

/** ws를 열고 snapshot이 올 때까지 기다린다. 닫히면 코드를 알려 준다. */
async function wsJoin(url) {
  const ws = new WebSocket(url);
  const got = { types: [], close: null };
  ws.addEventListener("message", (e) => got.types.push(JSON.parse(String(e.data)).event?.type));
  const closed = new Promise((res) =>
    ws.addEventListener("close", (e) => {
      got.close = e.code;
      res(e.code);
    }),
  );
  await new Promise((res) => {
    ws.addEventListener("open", () => (ws.send(JSON.stringify({ type: "join", data: {} })), res()));
    ws.addEventListener("error", () => res());
    ws.addEventListener("close", () => res());
  });
  for (let i = 0; i < 60 && !got.types.includes("snapshot") && got.close === null; i++) await sleep(50);
  return { ws, got, closed };
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);

async function scenario(name, mkEnv, mkToken, extraBad) {
  console.log(`\n[${name}]`);
  const dir = mkdtempSync(join(tmpdir(), "dp-smoke-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = { PORT: String(port), DATA_DIR: dir, WEB_ORIGIN: "http://localhost:3000", KP_AWAY_GRACE_MS: "60000", ...(await mkEnv()) };
  let api = startApi(env);
  try {
    ok(await waitFor(`${base}/health`), "서버가 떴다");
    const health = await (await get(`${base}/health`)).json();
    ok(health.ok === true && typeof health.uptimeSec === "number" && health.rooms === 0 && health.db?.status === "none", "/health 상세", JSON.stringify(health));
    const ready = await get(`${base}/ready`);
    ok(ready.status === 200, "/ready 200");
    const r0 = await get(`${base}/health`);
    ok(r0.headers.get("x-powered-by") === null, "X-Powered-By를 숨긴다");

    ok((await get(`${base}/rooms`)).status === 401, "토큰 없으면 401");
    ok((await get(`${base}/rooms?user=kp1&name=x`, { headers: { "x-dev-user": "kp1" } })).status === 401, "production에서 개발용 신원은 401");
    ok((await get(`${base}/rooms`, { headers: { authorization: "Bearer abc.def.ghi" } })).status === 401, "엉터리 토큰은 401");
    if (extraBad) ok((await get(`${base}/rooms`, { headers: { authorization: `Bearer ${extraBad()}` } })).status === 401, "다른 키로 서명한 토큰은 401");

    const token = mkToken("user-kp");
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const created = await get(`${base}/rooms`, { method: "POST", headers: auth, body: JSON.stringify({ name: "스모크 룸" }) });
    const room = await created.json();
    ok(created.status === 201 && typeof room.id === "string", "룸 만들기", String(created.status));
    const list = await (await get(`${base}/rooms`, { headers: auth })).json();
    ok(Array.isArray(list) && list.some((r) => r.id === room.id), "내 룸 목록");

    const up = await get(`${base}/images`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "image/png" }, body: PNG });
    const img = await up.json();
    ok(up.status === 201 && /^[a-f0-9]{32}$/.test(img.id ?? ""), "이미지 올리기", String(up.status));
    const back = await get(`${base}/images/${img.id}`);
    ok(back.status === 200 && back.headers.get("content-type") === "image/png" && Buffer.from(await back.arrayBuffer()).equals(PNG), "이미지 다시 받기");

    const bad = await wsJoin(`ws://127.0.0.1:${port}/ws?room=${room.id}&token=garbage&role=kp`);
    ok((await Promise.race([bad.closed, sleep(3000).then(() => null)])) === 4401, "ws: 엉터리 토큰은 4401로 닫힌다", String(bad.got.close));
    const dev = await wsJoin(`ws://127.0.0.1:${port}/ws?room=${room.id}&user=kp1&name=kp&role=kp`);
    ok((await Promise.race([dev.closed, sleep(3000).then(() => null)])) === 4401, "ws: 개발용 user 쿼리는 4401로 닫힌다");

    const c = await wsJoin(`ws://127.0.0.1:${port}/ws?room=${room.id}&token=${encodeURIComponent(token)}&role=kp`);
    ok(c.got.types.includes("snapshot"), "ws: 접속하면 snapshot을 받는다", c.got.types.join(","));
    c.ws.send(JSON.stringify({ id: "r1", command: { type: "dice.roll", data: { expr: "1d100" } } }));
    await sleep(300);
    ok(c.got.close === null, "ws: 명령 뒤에도 연결 유지");
    const h2 = await (await get(`${base}/health`)).json();
    ok(h2.rooms === 1 && h2.connections >= 1, "/health가 룸·연결 수를 센다", JSON.stringify(h2));

    // SIGTERM: 연결은 1012로 닫히고 프로세스는 0으로 끝나며 룸은 저장돼 있어야 한다.
    api.child.kill("SIGTERM");
    const code = await Promise.race([c.closed, sleep(8000).then(() => null)]);
    ok(code === 1012, "SIGTERM: ws가 1012(서버 재시작)로 닫힌다", String(code));
    const ex = await Promise.race([api.exited, sleep(10000).then(() => null)]);
    ok(ex?.code === 0, "SIGTERM: 종료 코드 0", JSON.stringify(ex));
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    ok(files.includes(`${room.id}.json`), "룸이 파일로 저장됐다", files.join(","));
    const saved = JSON.parse(readFileSync(join(dir, `${room.id}.json`), "utf8"));
    ok(typeof saved.data?.schemaVersion === "number", "저장 데이터에 schemaVersion", String(saved.data?.schemaVersion));

    // 다시 띄우면 룸이 그대로 있다.
    api = startApi(env);
    ok(await waitFor(`${base}/health`), "다시 띄웠다");
    const again = await get(`${base}/rooms/${room.id}`, { headers: auth });
    ok(again.status === 200, "재시작 뒤에도 룸이 있다", String(again.status));
    const c2 = await wsJoin(`ws://127.0.0.1:${port}/ws?room=${room.id}&token=${encodeURIComponent(token)}&role=kp`);
    ok(c2.got.types.includes("snapshot"), "재시작 뒤 ws 접속");
    c2.ws.close();
    if (/Error|error/.test(api.log().split("\n").filter((l) => l.includes('"level":"error"')).join(""))) ok(false, "서버 로그에 error가 없다", api.log().slice(-600));
    else ok(true, "서버 로그에 error가 없다");
  } finally {
    api.child.kill("SIGKILL");
    await Promise.race([api.exited, sleep(2000)]);
    rmSync(dir, { recursive: true, force: true });
  }
}

const now = Math.floor(Date.now() / 1000);

// 1) HS256(레거시 JWT Secret)
const SECRET = "smoke-secret-".repeat(4);
await scenario(
  "HS256 secret",
  async () => ({ SUPABASE_JWT_SECRET: SECRET }),
  (sub) => hsToken(SECRET, { sub, exp: now + 600, aud: "authenticated", user_metadata: { full_name: "스모크" } }),
  () => hsToken("another-secret-another-secret-123456", { sub: "x", exp: now + 600, aud: "authenticated" }),
);

// 2) JWKS(ES256 비대칭 키): 가짜 Supabase를 띄워 공개키 목록을 준다.
{
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwksPort = await freePort();
  let jwksHits = 0;
  const jwksServer = createServer((req, res) => {
    if (req.url === "/auth/v1/.well-known/jwks.json") {
      jwksHits += 1;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "smoke-1", use: "sig", alg: "ES256" }] }));
    }
    res.writeHead(404).end();
  }).listen(jwksPort, "127.0.0.1");
  const url = `http://127.0.0.1:${jwksPort}`;
  await scenario(
    "JWKS ES256",
    async () => ({ SUPABASE_URL: url }),
    (sub) => esToken(privateKey, "smoke-1", { sub, exp: now + 600, aud: "authenticated", iss: `${url}/auth/v1`, user_metadata: { full_name: "스모크" } }),
    () => esToken(other.privateKey, "smoke-1", { sub: "x", exp: now + 600, aud: "authenticated", iss: `${url}/auth/v1` }),
  );
  ok(jwksHits >= 1 && jwksHits <= 4, "JWKS는 캐시돼서 몇 번만 가져온다", `hits=${jwksHits}`);
  jwksServer.close();
}

// 3) 선택: 이미 떠 있는 `next start`
if (WEB_URL) {
  console.log(`\n[web ${WEB_URL}]`);
  const home = await get(WEB_URL);
  ok(home.status === 200, "홈 200", String(home.status));
  ok(home.headers.get("x-content-type-options") === "nosniff", "X-Content-Type-Options: nosniff");
  ok(/frame-ancestors 'none'|DENY/i.test((home.headers.get("content-security-policy") ?? "") + (home.headers.get("x-frame-options") ?? "")), "프레임 삽입 차단 헤더");
  ok(home.headers.get("referrer-policy") !== null, "Referrer-Policy");
  ok(home.headers.get("x-powered-by") === null, "X-Powered-By 없음");
  const nf = await get(`${WEB_URL}/no-such-page-xyz`);
  const nfText = await nf.text();
  ok(nf.status === 404 && /찾을 수 없어요/.test(nfText), "없는 주소는 안내 문장이 있는 404", String(nf.status));
}

console.log(failures ? `\n실패 ${failures}건` : "\n모두 통과");
process.exit(failures ? 1 : 0);
