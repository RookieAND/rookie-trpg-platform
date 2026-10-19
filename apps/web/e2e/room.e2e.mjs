// 두 브라우저(GM, PL)로 실제 화면을 조작해 실시간 동작을 확인한다.
// 사전 조건: pnpm dev:realtime(=api), pnpm dev:web 이 떠 있어야 한다.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const WEB = process.env.WEB_URL ?? "http://localhost:3000";
// API 주소. 다른 포트로 띄운 서버에 돌릴 때 API_URL로 알려 준다.
const API = process.env.API_URL ?? "http://localhost:8787";
const exe = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--no-proxy-server", "--disable-dev-shm-usage"] });
// 직접 만든 드롭다운(Select)을 기본 select처럼 다루는 도우미
const __tmp = await browser.newContext();
const __pg = await __tmp.newPage();
const LocatorProto = Object.getPrototypeOf(__pg.locator("body"));
const __origSelect = LocatorProto.selectOption;
LocatorProto.selectOption = async function (arg, opts) {
  const isCustom = (await this.getAttribute("role", opts)) === "combobox";
  if (!isCustom) return __origSelect.call(this, arg, opts);
  const page = this.page();
  await this.click(opts);
  const list = page.locator('[role="listbox"]');
  const opt = typeof arg === "string" ? list.locator(`[role="option"][data-value="${arg.replace(/"/g, '\\"')}"]`) : list.locator('[role="option"]').filter({ has: page.locator(".select-opt-label", { hasText: new RegExp("^\\s*" + String(arg.label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$") }) });
  await opt.first().click(opts);
};
// 시트 대화상자가 열린 채 그 밖의 것을 누르려 하면 먼저 닫는다(대화상자가 화면을 덮기 때문)
const __origClick = LocatorProto.click;
LocatorProto.click = async function (opts) {
  const page = this.page();
  if ((await page.getByTestId("sheet-modal").count()) > 0) {
    const inside = await this.evaluate((el) => Boolean(el.closest('[data-testid="sheet-modal"], [role="dialog"], [data-testid="toast"], [data-testid="con-banner"], [role="status"], [role="alert"]')), undefined, { timeout: 2000 }).catch(() => false);
    if (!inside) {
      await page.getByTestId("sheet-close").click();
      await page.getByTestId("sheet-modal").waitFor({ state: "detached" });
    }
  }
  return __origClick.call(this, opts);
};
const __origInputValue = LocatorProto.inputValue;
LocatorProto.inputValue = async function (opts) {
  if ((await this.getAttribute("role", opts)) === "combobox") return (await this.getAttribute("data-value", opts)) ?? "";
  return __origInputValue.call(this, opts);
};
// 드롭다운의 옵션 글자 목록(열었다 닫는다)과 현재 고른 글자
const selOptions = async (loc) => {
  await loc.click();
  const t = await loc.page().locator('[role="listbox"] [role="option"]').allInnerTexts();
  await loc.page().keyboard.press("Escape");
  return t.map((x) => x.replace(/\s*✓\s*$/, "").trim());
};
const selCurrent = async (loc) => (await loc.locator(".select-label").innerText()).trim();
await __tmp.close();
// 느린 개발 서버·바쁜 머신에서도 흔들리지 않게 기본 대기를 넉넉히 둔다(E2E_TIMEOUT_MS로 조절).
const ctx = async () => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  c.setDefaultTimeout(Number(process.env.E2E_TIMEOUT_MS ?? 30000));
  // 기존 시험은 장면 탭을 직접 누른다. 많은 장면용 이동기·목록은 별도 단계에서 확인한다.
  await c.addInitScript(() => { try { localStorage.setItem("rc-scene-tabs-max", "99"); } catch {} });
  // E2E_DEBUG=1이면 화면의 스크립트 오류와 console.error를 그대로 보여 준다(개발 서버의 오류 창이 클릭을 가릴 때 원인을 찾는 용도).
  if (process.env.E2E_DEBUG) {
    c.on("page", (p) => {
      (globalThis.__pages ??= []).push(p);
      p.on("pageerror", (e) => console.error("[pageerror]", e.message.slice(0, 400)));
      p.on("console", (m) => m.type() === "error" && console.error("[console.error]", m.text().slice(0, 400)));
    });
  }
  return c;
};
// 같은 서버로 여러 번 돌려도 이전 실행의 룸·캐릭터와 섞이지 않게 이름에 실행 번호를 붙인다.
const run = Date.now().toString(36);
const ROOM = `안개 낀 저택 ${run}`;
const CHAR = `윤서하 ${run}`;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/shots-pltools";
await (await import("node:fs/promises")).mkdir(SHOTS, { recursive: true });
const step = (m) => console.log("✓", m);
// 화면 안 확인 창(window.confirm 대신): 확인 버튼(submit)을 누른다.
const confirmAsk = async (page) => { const d = page.getByTestId("ask-dialog"); await d.waitFor(); await d.locator('button[type="submit"]').click(); await d.waitFor({ state: "detached" }); };
// 설정·장면 설정 메뉴 안의 항목은 메뉴를 먼저 열어야 보인다. 쓰고 나면 Esc로 닫아 아래 화면을 가리지 않게 한다.
const openSettings = async (page) => { if (!(await page.getByRole("menu").count())) await page.getByTestId("settings-menu").click(); };
// 판정 요청 폼과 안개 더보기는 접혀 있다. 필요할 때 펼친다.
const openAsk = async (page) => { if (!(await page.getByLabel("요청할 기능").count())) await page.getByRole("button", { name: "판정 요청" }).click(); };
// GM 데스크톱의 보드 아래 도구 줄은 놓기·안개·연출 탭이다. 휴대폰에는 이 탭이 없어서(도구 시트를 쓴다) 아무 일도 하지 않는다.
// 시트는 탭의 인물 목록에서 카드를 눌러 대화상자로 연다.
const closeSheet = async (page) => { if (await page.getByTestId("sheet-modal").count()) { await page.getByTestId("sheet-close").click(); await page.getByTestId("sheet-modal").waitFor({ state: "detached" }); } };
const sheetTabOnly = async (page) => { await closeSheet(page); await page.getByRole("tab", { name: "시트" }).click(); };
const sheetTab = async (page, name) => {
  await closeSheet(page);
  await page.getByRole("tab", { name: "시트" }).click();
  const cards = page.getByTestId("sheet-card");
  await (name ? cards.filter({ has: page.locator(`b.sl-name`, { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) }) : cards).first().click();
  await page.getByTestId("sheet-modal").waitFor();
};
const dockTab = async (page, id) => { const t = page.getByTestId(`dock-tab-${id}`); if ((await t.count()) && (await t.getAttribute("aria-selected")) !== "true") await t.click(); };
// 장면 막대의 ＋ 버튼으로 화면 안 대화상자를 열어 새 장면을 만든다.
const addScene = async (page, name) => { await page.getByTestId("scene-add").click(); const d = page.getByTestId("ask-dialog"); await d.getByLabel("장면 이름").fill(name); await d.locator('button[type="submit"]').click(); await d.waitFor({ state: "detached" }); };
const openFogMore = async (page) => { await dockTab(page, "fog"); const b = page.getByTestId("fog-toolbar").getByRole("button", { name: /^더보기|^접기/ }); if ((await b.getAttribute("aria-expanded")) !== "true") await b.click(); };
const openSceneMenu = async (page) => { if (!(await page.getByRole("menu").count())) await page.getByRole("button", { name: /장면 설정/ }).click(); };

// 이전 실행이 남긴 룸이 사용자별 룸 수 한도를 채우지 않게, 시작할 때 이 시험의 사용자들 룸을 비운다.
for (const who of ["하늘", "서하", "낯선이"]) {
  const h = { "x-dev-user": encodeURIComponent(who), "x-dev-name": encodeURIComponent(who) };
  const list = await fetch(`${API}/rooms`, { headers: h }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  for (const r of list) if (r.role === "kp") await fetch(`${API}/rooms/${r.id}`, { method: "DELETE", headers: h }).catch(() => {});
  // 보관함도 한도가 있으니 이전 실행이 남긴 캐릭터를 비운다.
  const vault = await fetch(`${API}/characters`, { headers: h }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  for (const c of vault) if (c.id) await fetch(`${API}/characters/${c.id}`, { method: "DELETE", headers: h }).catch(() => {});
}

const login = async (page, name) => {
  await page.goto(WEB);
  if (!login.checked) {
    // 이름이 비면 시작하기가 막히고, 이유가 버튼 아래 한 줄로 보이며 aria-describedby로 이어진다
    login.checked = true;
    await page.getByTestId("login-why").waitFor();
    const startBtn = page.getByRole("button", { name: "시작하기" });
    assert.equal(await startBtn.isDisabled(), true);
    assert.equal(await startBtn.getAttribute("aria-describedby"), "login-why");
    assert.match(await page.getByTestId("login-why").innerText(), /이름/);
    assert.match(await page.title(), /^밤의 탁자$/);
    assert.equal((await fetch(`${WEB}/icon.png`)).status, 200, "탭 아이콘이 있어야 해요");
    assert.equal((await fetch(`${WEB}/logo-128.png`)).status, 200, "화면 안 로고가 있어야 해요");
    const manifest = await (await fetch(`${WEB}/manifest.webmanifest`)).json();
    assert.ok(manifest.icons.length >= 2 && manifest.name, "홈 화면 추가용 manifest가 있어야 해요");
  }
  await page.getByLabel("이름").fill(name);
  await page.getByRole("button", { name: "시작하기" }).click();
};

try {
  // GM: 로그인 → 새 룸 → 세션 시작 전 상태
  const kp = await (await ctx()).newPage();
  await login(kp, "하늘");
  await kp.getByLabel("새 룸 이름").fill(ROOM);
  await kp.getByRole("button", { name: "새 룸 만들기", exact: true }).click();
  await kp.waitForURL(/\/room\//);
  const roomUrl = kp.url();
  await kp.getByTestId("connection").getByText("연결됨").waitFor();
  await kp.getByText("세션 시작 전이에요").waitFor();
  await kp.waitForFunction((n) => document.title.includes(n) && document.title.includes("밤의 탁자"), ROOM);
  step("GM이 룸을 만들고 입장 (세션 시작 전, 탭 제목에 룸 이름)");

  // 초대 링크 받기
  await kp.getByRole("button", { name: "초대", exact: true }).click();
  const inviteLink = await kp.getByLabel("초대 링크 주소").inputValue();
  assert.match(inviteLink, /\/join\/.+\?invite=/);
  await kp.keyboard.press("Escape");
  await kp.getByRole("dialog").waitFor({ state: "detached" });
  // 창을 다시 열어도 링크가 그대로여야 먼저 보낸 링크가 죽지 않는다
  await kp.getByRole("button", { name: "초대", exact: true }).click();
  assert.equal(await kp.getByLabel("초대 링크 주소").inputValue(), inviteLink);
  await kp.waitForTimeout(150);
  await kp.keyboard.press("Escape");
  await kp.getByRole("dialog").waitFor({ state: "detached" });
  step("GM이 초대 링크를 만듦(다시 열어도 같은 링크)");

  // 디스코드 알림: 잘못된 주소는 거절, 올바른 형식은 저장되고 연결됨으로 보임
  await openSettings(kp);
  await kp.getByRole("button", { name: "디스코드", exact: true }).click();
  await kp.getByLabel("웹훅 주소").fill("https://example.com/hook");
  await kp.getByRole("button", { name: "저장", exact: true }).click();
  await kp.getByText("웹훅 주소 형식이 아니에요").waitFor();
  await kp.getByLabel("웹훅 주소").fill("https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-ABC");
  await kp.getByRole("button", { name: "저장", exact: true }).click();
  await kp.getByText("저장했어요").waitFor();
  await kp.getByText("채널이 연결돼 있어요").waitFor();
  await kp.keyboard.press("Escape");
  await kp.getByRole("dialog").waitFor({ state: "detached" });
  step("GM이 디스코드 웹훅을 연결함(주소는 다시 보여 주지 않음)");

  // 초대 없이 들어오려는 사람은 막힘
  const stranger = await (await ctx()).newPage();
  await login(stranger, "낯선이");
  await stranger.goto(roomUrl);
  await stranger.getByText("들어갈 수 없어요").waitFor();
  step("초대 없는 사람은 입장이 막힘");

  // PL: 초대 링크로 입장
  const pl = await (await ctx()).newPage();
  await pl.goto(inviteLink);
  await pl.getByLabel("이름").fill("서하");
  await pl.getByRole("button", { name: "계속하기" }).click();
  await pl.getByRole("button", { name: "PL로 입장" }).click();
  await pl.getByTestId("connection").getByText("연결됨").waitFor();
  await kp.getByText("접속 하늘, 서하").waitFor();
  await pl.getByText("GM이 세션을 시작하기를 기다리고").waitFor();
  step("PL이 초대 링크로 입장, GM 화면에 보임");

  // 세션 시작 전에는 PL이 굴릴 수 없고, GM이 시작하면 열림
  assert.equal(await pl.getByLabel("굴림 식").isDisabled(), true);
  assert.match(await pl.getByTestId("roll-why").innerText(), /GM이 세션을 시작/);
  assert.equal(await pl.locator('button[aria-describedby="roll-why"]').isDisabled(), true);
  await kp.getByRole("button", { name: "세션 시작" }).click();
  await pl.getByTestId("session-status").getByText("진행 중").waitFor();
  assert.equal(await pl.getByLabel("굴림 식").isDisabled(), false);
  assert.equal(await pl.getByTestId("roll-why").count(), 0);
  step("GM이 세션을 시작하면 PL 입력이 열리고, 그 전에는 막힌 이유가 한 줄로 보임");

  // 로비 목록에 룸이 보임
  const lobby = await (await ctx()).newPage();
  await login(lobby, "서하");
  await lobby.getByTestId("room-card").getByText(ROOM).waitFor();
  step("PL 로비에 참가한 룸이 보임");

  // 보관함: 캐릭터 만들기
  await lobby.getByRole("link", { name: "내 캐릭터" }).click();
  await lobby.getByRole("button", { name: "새 캐릭터" }).click();
  await lobby.getByLabel("이름", { exact: true }).fill(CHAR);
  await lobby.getByLabel("직업", { exact: true }).fill("기자");
  await lobby.getByRole("button", { name: "특성치 굴리기" }).click();
  assert.equal(Number(await lobby.getByLabel("STR", { exact: true }).inputValue()) % 5, 0);
  await lobby.getByRole("button", { name: "기본 기능 채우기" }).click();
  assert.equal(await lobby.getByLabel("기능 이름 6").inputValue(), "도서관 이용");
  assert.ok((await lobby.getByLabel(/^기능 이름 /).count()) > 30);
  for (const k of ["CON", "SIZ", "POW"]) await lobby.getByLabel(k, { exact: true }).fill("50");
  await lobby.getByLabel("기능 값 6").fill("60");
  await lobby.getByRole("button", { name: "+ 무기 추가" }).click();
  await lobby.getByLabel("무기 이름 1").fill("주먹");
  await lobby.getByLabel("무기 기능 1").fill("맨손 격투");
  await lobby.getByLabel("무기 피해 1").fill("1d3+db");
  await lobby.getByLabel("소지품").fill("손전등");
  assert.match(await lobby.getByTestId("derived").innerText(), /HP 10 · MP 10 · SAN 50/);
  await lobby.getByRole("button", { name: "저장" }).click();
  await lobby.getByTestId("vault-card").getByText(CHAR).waitFor();
  // 생성 마법사: 나이 보정(17세)과 기능 포인트 규칙을 지켜야 다음으로 넘어가고, 만들면 보관함에 생김
  const WIZ = "마법사 " + run;
  await lobby.getByRole("button", { name: "마법사로 만들기" }).click();
  await lobby.getByLabel("이름", { exact: true }).fill(WIZ);
  await lobby.getByLabel("나이").fill("17");
  await lobby.getByLabel("직업", { exact: true }).fill("학생");
  await lobby.getByRole("button", { name: "다음" }).click();
  for (const [k, v] of Object.entries({ STR: 60, CON: 50, SIZ: 60, DEX: 50, APP: 50, INT: 60, POW: 50, EDU: 70 })) await lobby.getByLabel(`${k} 기본값`).fill(String(v));
  await lobby.getByTestId("age-rules").waitFor();
  assert.equal(await lobby.getByRole("button", { name: "다음" }).isDisabled(), true);
  await lobby.getByLabel("STR 깎기").fill("3");
  await lobby.getByLabel("SIZ 깎기").fill("1");
  await lobby.getByRole("alert").filter({ hasText: "합계 5" }).waitFor();
  await lobby.getByLabel("SIZ 깎기").fill("2");
  await lobby.getByTestId("final-stats").getByText(/STR 57 · CON 50 · SIZ 58 · DEX 50 · APP 50 · INT 60 · POW 50 · EDU 65/).waitFor();
  await lobby.getByRole("button", { name: "다음" }).click();
  await lobby.getByTestId("points-left").getByText("직업 260 / 260 남음 · 관심 120 / 120 남음").waitFor();
  await lobby.getByLabel("관찰력 직업 포인트").fill("300");
  await lobby.getByRole("alert").filter({ hasText: "직업 포인트를" }).first().waitFor();
  assert.equal(await lobby.getByRole("button", { name: "다음" }).isDisabled(), true);
  await lobby.getByLabel("관찰력 직업 포인트").fill("40");
  await lobby.getByLabel("심리학 관심 포인트").fill("10");
  await lobby.getByTestId("points-left").getByText("직업 220 / 260 남음 · 관심 110 / 120 남음").waitFor();
  await lobby.getByRole("button", { name: "다음" }).click();
  await lobby.getByTestId("review").getByText(/학생/).waitFor();
  await lobby.getByRole("button", { name: "캐릭터 만들기" }).click();
  const wizCard = lobby.getByTestId("vault-card").filter({ hasText: WIZ });
  await wizCard.waitFor();
  await wizCard.getByRole("button", { name: "삭제" }).click();
  await confirmAsk(lobby);
  await wizCard.waitFor({ state: "detached" });
  step("생성 마법사: 17세 나이 보정과 기능 포인트 규칙을 지켜야 진행되고, 만들면 보관함에 생김");
  // 직업 정의: 정의해 두면 마법사에서 직업 기능·신용도 범위를 지키게 하고, 지울 수 있다
  const JOB = "탐정 " + run;
  const WIZ2 = "직업 캐릭터 " + run;
  await lobby.getByRole("button", { name: "직업 정의하기" }).click();
  await lobby.getByLabel("직업 이름").fill(JOB);
  await lobby.getByLabel("신용도 최소").fill("20");
  await lobby.getByLabel("신용도 최대").fill("40");
  await lobby.getByLabel("법률", { exact: true }).check();
  await lobby.getByLabel("관찰력", { exact: true }).check();
  await lobby.getByRole("button", { name: "직업 저장" }).click();
  await lobby.getByTestId("occupation-item").filter({ hasText: JOB }).waitFor();
  await lobby.getByRole("button", { name: "마법사로 만들기" }).click();
  await lobby.getByLabel("이름", { exact: true }).fill(WIZ2);
  await lobby.getByLabel("정의해 둔 직업").selectOption({ label: JOB });
  assert.equal(await lobby.getByLabel("직업", { exact: true }).inputValue(), JOB);
  await lobby.getByRole("button", { name: "다음" }).click();
  assert.equal(await lobby.getByRole("button", { name: "다음" }).isDisabled(), true);
  assert.match(await lobby.getByTestId("wizard-next-why").innerText(), /교육 향상 판정/);
  assert.equal(await lobby.getByRole("button", { name: "다음" }).getAttribute("aria-describedby"), "wizard-next-why");
  await lobby.getByRole("button", { name: "교육 향상 판정" }).click();
  await lobby.getByTestId("edu-result").waitFor();
  await lobby.getByRole("button", { name: "다음" }).click();
  assert.equal(await lobby.getByLabel("설득 직업 포인트").isDisabled(), true);
  await lobby.getByLabel("법률 직업 포인트").fill("10");
  await lobby.getByRole("alert").filter({ hasText: "신용도는" }).waitFor();
  assert.equal(await lobby.getByRole("button", { name: "다음" }).isDisabled(), true);
  await lobby.getByLabel("신용도 직업 포인트").fill("25");
  await lobby.getByRole("button", { name: "다음" }).click();
  await lobby.getByRole("button", { name: "캐릭터 만들기" }).click();
  const wizCard2 = lobby.getByTestId("vault-card").filter({ hasText: WIZ2 });
  await wizCard2.waitFor();
  await wizCard2.getByRole("button", { name: "삭제" }).click();
  await confirmAsk(lobby);
  await wizCard2.waitFor({ state: "detached" });
  // 고치기·내보내기·가져오기
  await lobby.getByRole("button", { name: `${JOB} 직업 수정` }).click();
  assert.equal(await lobby.getByLabel("직업 이름").inputValue(), JOB);
  await lobby.getByLabel("신용도 최대").fill("45");
  await lobby.getByRole("button", { name: "수정 저장" }).click();
  await lobby.getByTestId("occupation-item").filter({ hasText: JOB }).filter({ hasText: "20~45" }).waitFor();
  const [jobDl] = await Promise.all([lobby.waitForEvent("download"), lobby.getByRole("button", { name: "내보내기", exact: true }).click()]);
  const jobFile = await (await import("node:fs/promises")).readFile(await jobDl.path(), "utf8");
  assert.ok(jobFile.includes(JOB) && !jobFile.includes('"id"'));
  await lobby.getByRole("button", { name: `${JOB} 직업 삭제` }).click();
  await lobby.getByTestId("occupation-item").filter({ hasText: JOB }).waitFor({ state: "detached" });
  await lobby.getByLabel("직업 파일 가져오기").setInputFiles({ name: "jobs.json", mimeType: "application/json", buffer: Buffer.from(jobFile) });
  await lobby.getByTestId("occupation-item").filter({ hasText: JOB }).filter({ hasText: "20~45" }).waitFor();
  await lobby.getByRole("status").filter({ hasText: "1개를 가져왔어요" }).waitFor();
  await lobby.getByRole("button", { name: `${JOB} 직업 삭제` }).click();
  await lobby.getByTestId("occupation-item").filter({ hasText: JOB }).waitFor({ state: "detached" });
  step("직업 정의: 직업 기능에만 직업 포인트를 쓰고 신용도 범위를 지켜야 만들어지며, 정의는 고치고·내보내고·가져오고·지울 수 있음");
  // CSV: 보관함 카드에서 내보내고, 그 파일을 다시 가져와 미리보기 → 폼에 적용
  {
    const fs = await import("node:fs/promises");
    const [dl] = await Promise.all([lobby.waitForEvent("download"), lobby.getByRole("button", { name: `${CHAR} CSV로 내보내기` }).click()]);
    const raw = await fs.readFile(await dl.path());
    assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 BOM으로 시작해야 함");
    const csvText = raw.toString("utf8");
    for (const h of ["[기본 정보]", "[특성치]", "[파생 수치]", "[기능]", "[무기]", "[소지품]", "[비고]"]) assert.ok(csvText.includes(h), h);
    assert.ok(csvText.includes(CHAR) && csvText.includes("주먹,맨손 격투,1d3+db") && csvText.includes("손전등"));
    await lobby.getByRole("button", { name: "CSV로 가져오기" }).click();
    await lobby.getByText("구글 시트와 계속 이어지지 않고").waitFor();
    // 잘못된 글은 오류를 보이고 적용할 수 없다
    await lobby.getByLabel("CSV 붙여넣기").fill("아무 글");
    await lobby.getByTestId("csv-errors").waitFor();
    assert.equal(await lobby.getByTestId("csv-apply").isDisabled(), true);
    // 일부 행이 틀리면 건너뛰고 알린다
    const broken = csvText.replace(/관찰력,25,/, "관찰력,250,").replace("외국어,1,", "외국어,abc,");
    await lobby.getByLabel("CSV 파일").setInputFiles({ name: "broken.csv", mimeType: "text/csv", buffer: Buffer.from(broken) });
    await lobby.getByTestId("csv-warnings").getByText(/건너뛴 행 2개/).waitFor();
    assert.match(await lobby.getByTestId("csv-warnings").innerText(), /관찰력/);
    // 올바른 파일은 미리보기를 거쳐 새 폼에 적용된다
    await lobby.getByLabel("CSV 파일").setInputFiles({ name: "ok.csv", mimeType: "text/csv", buffer: raw });
    await lobby.getByTestId("csv-preview").getByText(CHAR).waitFor();
    assert.equal(await lobby.getByTestId("csv-errors").count(), 0);
    await lobby.getByTestId("csv-apply").click();
    assert.equal(await lobby.getByLabel("이름", { exact: true }).inputValue(), CHAR);
    assert.equal(await lobby.getByLabel("기능 값 6").inputValue(), "60");
    assert.equal(await lobby.getByLabel("소지품").inputValue(), "손전등");
    assert.equal(await lobby.getByLabel("무기 이름 1").inputValue(), "주먹");
    assert.match(await lobby.getByTestId("derived").innerText(), /HP 10 · MP 10 · SAN 50/);
    // 시트 UI: 묶음 접기, 기능 찾기, 수정한 기능만 보기
    const total = await lobby.getByLabel(/^기능 이름 /).count();
    assert.ok(total > 30);
    await lobby.getByLabel("기능 찾기").fill("도서");
    assert.equal(await lobby.getByLabel(/^기능 이름 /).count(), 1);
    await lobby.getByLabel("기능 찾기").fill("");
    await lobby.getByLabel("수정한 기능만 보기").check();
    assert.equal(await lobby.getByLabel(/^기능 이름 /).count(), 1, "수정한 기능은 도서관 이용(60) 하나");
    assert.equal(await lobby.getByLabel("기능 이름 6").inputValue(), "도서관 이용");
    await lobby.getByLabel("수정한 기능만 보기").uncheck();
    assert.equal(await lobby.getByLabel(/^기능 이름 /).count(), total);
    const skillToggle = lobby.getByTestId("cf-skills").getByRole("button", { name: /^기능/ }).first();
    await skillToggle.click();
    assert.equal(await lobby.getByLabel("기능 이름 6").isVisible(), false);
    await skillToggle.click();
    assert.equal(await lobby.getByLabel("기능 이름 6").isVisible(), true);
    // 양식 받기: 이름이 비어 있어 그대로는 가져와지지 않는다
    const [tpl] = await Promise.all([lobby.waitForEvent("download"), lobby.getByRole("button", { name: "양식 받기" }).click()]);
    const tplRaw = await fs.readFile(await tpl.path());
    assert.deepEqual([...tplRaw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    await lobby.getByRole("button", { name: "CSV로 가져오기" }).click();
    await lobby.getByLabel("CSV 파일").setInputFiles({ name: "양식.csv", mimeType: "text/csv", buffer: tplRaw });
    await lobby.getByTestId("csv-errors").getByText(/이름이 없어요/).waitFor();
    // 이름만 채운 양식은 가져와진다
    await lobby.getByLabel("CSV 붙여넣기").fill(tplRaw.toString("utf8").replace("이름,\r\n", "이름,양식 조사자\r\n"));
    await lobby.getByTestId("csv-preview").getByText("양식 조사자").waitFor();
    // 구글 시트 링크: 주소 모양이 아니면 서버에 묻지 않고 알려 준다
    await lobby.getByLabel("구글 시트 링크").fill("https://evil.example/spreadsheets/d/abc");
    await lobby.getByRole("button", { name: "링크로 읽기" }).click();
    await lobby.getByTestId("csv-problem").getByText(/구글 시트 링크가 아니에요/).waitFor();
    // 서버도 같은 주소를 거절한다(로그인 필요, 허용 목록 밖은 400)
    const h = { "content-type": "application/json", "x-dev-user": encodeURIComponent("서하"), "x-dev-name": encodeURIComponent("서하") };
    const bad = await fetch(`${API}/sheet-import/google`, { method: "POST", headers: h, body: JSON.stringify({ url: "http://127.0.0.1:8787/spreadsheets/d/abc" }) });
    assert.equal(bad.status, 400);
    const anon = await fetch(`${API}/sheet-import/google`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(anon.status, 401);
    await lobby.getByRole("button", { name: "취소" }).click();
  }
  step("CSV: 보관함 카드에서 내보낸 파일(BOM)을 다시 가져오면 미리보기 뒤 폼에 그대로 적용되고, 틀린 행은 건너뛰며, 양식·구글 링크 검사·기능 찾기·접기가 동작함");
  await lobby.context().close();
  step("PL이 보관함에 캐릭터를 만듦 (파생 수치 미리보기 포함)");

  // 룸에서 불러오기 → HP 조절 → 시트로 굴리기
  await pl.getByRole("tab", { name: "시트" }).click();
  await pl.getByTestId("vault-item").filter({ hasText: CHAR }).getByRole("button", { name: "불러오기" }).click();
  await sheetTab(pl);
  await pl.getByTestId("stat-hp").getByText("10/10").waitFor();
  step("PL이 보관함 캐릭터를 룸으로 불러옴");

  await pl.getByRole("button", { name: "HP 감소" }).click();
  await pl.getByTestId("stat-hp").getByText("9/10").waitFor();
  await sheetTab(kp);
  await kp.getByTestId("stat-hp").getByText("9/10").waitFor();
  step("PL의 HP 변경이 GM 시트에도 반영됨");

  // 시트 글칸: 쓰는 도중 다른 쪽이 HP를 바꿔(시트 rev가 올라가도) 입력 중인 글이 지워지지 않고, 칸을 벗어나면 저장됨
  {
    const memo = pl.getByLabel("메모", { exact: true });
    await memo.fill("지하실 열쇠는 서재에 있다");
    await kp.getByRole("button", { name: "HP 증가" }).click();
    await pl.getByTestId("stat-hp").getByText("10/10").waitFor();
    await pl.waitForTimeout(300);
    assert.equal(await memo.inputValue(), "지하실 열쇠는 서재에 있다", "다른 변경이 와도 입력 중인 글이 남아야 해요");
    assert.equal(await memo.evaluate((e) => document.activeElement === e), true, "초점도 그대로여야 해요");
    await pl.keyboard.type(" · 확인");
    await kp.getByRole("button", { name: "HP 감소" }).click();
    await pl.getByTestId("stat-hp").getByText("9/10").waitFor();
    assert.equal(await memo.inputValue(), "지하실 열쇠는 서재에 있다 · 확인");
    await pl.getByTestId("stat-hp").click(); // 칸을 벗어나면 저장
    await kp.waitForFunction(() => [...document.querySelectorAll("textarea")].some((t) => t.value === "지하실 열쇠는 서재에 있다 · 확인"));
  }
  step("시트 메모에 쓰는 도중 상대가 HP를 바꿔도 글이 지워지지 않고, 칸을 벗어나면 GM 시트에 저장됨");

  // HP 빠른 조정: ±5 버튼과 직접 입력(값, +3, -7)을 범위 안으로 맞춰 적용
  {
    const hp = pl.getByTestId("stat-hp");
    await pl.getByRole("button", { name: "HP 5 감소" }).click();
    await hp.getByText("4/10").waitFor();
    await pl.getByRole("button", { name: "HP 5 증가" }).click();
    await hp.getByText("9/10").waitFor();
    const box = pl.getByLabel("HP 직접 입력");
    await box.fill("-7");
    await box.press("Enter");
    await hp.getByText("2/10").waitFor();
    await box.fill("+3");
    await box.press("Enter");
    await hp.getByText("5/10").waitFor();
    await box.fill("-50");
    await box.press("Enter");
    await hp.getByText("0/10").waitFor();
    await box.fill("99");
    await box.press("Enter");
    await hp.getByText("10/10").waitFor();
    await kp.getByTestId("stat-hp").getByText("10/10").waitFor();
    // GM도 같은 시트를 직접 입력으로 고칠 수 있고, 글자가 아니면 거절 표시만 한다
    const gbox = kp.getByLabel("HP 직접 입력");
    await gbox.fill("9");
    await gbox.press("Enter");
    await pl.getByTestId("stat-hp").getByText("9/10").waitFor();
    await pl.getByLabel("HP 직접 입력").fill("abc");
    await pl.getByLabel("HP 직접 입력").press("Enter");
    assert.equal(await pl.getByLabel("HP 직접 입력").getAttribute("aria-invalid"), "true");
    await pl.getByLabel("HP 직접 입력").fill("");
    await hp.getByText("9/10").waitFor();
  }
  step("HP ±5 버튼과 직접 입력(값·+3·-7)이 0~최대 안으로 맞춰져 적용되고 GM에게도 반영됨");

  await pl.getByRole("button", { name: "도서관 이용 굴리기" }).click();
  // 시트에서 굴려도 오른쪽 탭이 굴림으로 바뀌지 않고, 결과는 토스트로 바로 보인다(굴림 기록에는 쌓임)
  await pl.getByTestId("toast").getByText(new RegExp(`${CHAR} · 도서관 이용 · \\d+`)).waitFor();
  assert.equal(await pl.getByRole("tab", { name: "시트" }).getAttribute("aria-selected"), "true");
  assert.equal(await pl.getByRole("tab", { name: "굴림" }).getAttribute("aria-selected"), "false");
  await closeSheet(kp); await kp.getByRole("tab", { name: "굴림" }).click();
  await kp.getByTestId("roll-entry").getByText(`${CHAR} · 도서관 이용`).waitFor();
  await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
  assert.equal(await pl.getByTestId("roll-entry").first().getByText(`${CHAR} · 도서관 이용`).count(), 1);
  step("시트로 굴린 결과가 라벨과 함께 로그에 남음");

  // SAN 체크: 손실을 2/2로 고정해 결과가 무작위여도 SAN이 정확히 2 줄어든다
  await sheetTab(pl);
  const sanBefore = Number((await pl.getByTestId("stat-san").innerText()).split("/")[0]);
  await pl.getByLabel("SAN 손실").fill("2/2");
  await pl.getByRole("button", { name: "SAN 체크", exact: true }).click();
  // 실수로 눌러도 바로 굴러가지 않는다: 확인 단계에서 값을 보여 주고, 취소하면 SAN이 그대로다
  await pl.getByTestId("san-confirm").getByText("되돌릴 수 없어요").waitFor();
  await pl.getByRole("button", { name: "취소" }).click();
  assert.equal(await pl.getByTestId("san-confirm").count(), 0);
  assert.equal(await pl.getByTestId("roll-entry").filter({ hasText: "SAN 체크" }).count(), 0);
  // 확인 창은 모달 대화상자: Esc로 닫히고 초점이 SAN 체크 버튼으로 돌아온다
  await pl.getByRole("button", { name: "SAN 체크", exact: true }).click();
  const sanDlg = pl.getByRole("dialog", { name: "SAN 체크 확인" });
  await sanDlg.waitFor();
  assert.equal(await sanDlg.getAttribute("aria-modal"), "true");
  await pl.keyboard.press("Escape");
  assert.equal(await pl.getByRole("dialog", { name: "SAN 체크 확인" }).count(), 0);
  assert.equal(await pl.evaluate(() => document.activeElement?.textContent), "SAN 체크");
  await pl.getByRole("button", { name: "SAN 체크", exact: true }).click();
  await pl.getByRole("button", { name: "SAN 체크 굴리기" }).click();
  await kp.getByTestId("roll-entry").getByText(`${CHAR} · SAN 체크`).waitFor();
  await sheetTab(pl);
  await pl.getByTestId("stat-san").getByText(new RegExp(`^${sanBefore - 2}/`)).waitFor();
  await pl.getByTestId("san-day").getByText("오늘 손실 2").waitFor();
  await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
  step("SAN 체크가 로그에 남고 SAN과 오늘 손실이 갱신됨");
  // SAN 효과: 5 이상 잃으면 절제된 화면 효과가 나오고, 내가 효과를 끄면 나오지 않는다
  await sheetTab(pl);
  await pl.getByLabel("SAN 손실").fill("6/6");
  await pl.getByRole("button", { name: "SAN 체크", exact: true }).click();
  await pl.getByRole("button", { name: "SAN 체크 굴리기" }).click();
  await pl.getByTestId("san-effect").waitFor();
  await pl.getByTestId("san-effect").waitFor({ state: "detached", timeout: 6000 });
  await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
  step("SAN 큰 손실에는 화면 가장자리가 어두워지는 효과가 나왔다 사라짐");

  // 푸시와 행운: 서버 주사위라 결과를 정할 수 없으니 실패가 나올 때까지 시트 판정을 굴린다
  const rollSkill = async () => {
    const entries = pl.getByTestId("roll-entry");
    const before = await entries.count();
    await sheetTab(pl);
    await pl.getByRole("button", { name: "도서관 이용 굴리기" }).click();
    await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
    await pl.waitForFunction((n) => document.querySelectorAll('[data-testid="roll-entry"]').length > n, before);
    await pl.waitForTimeout(250);
    return entries.first();
  };
  let pushed = false;
  for (let i = 0; i < 40 && !pushed; i++) {
    const first = await rollSkill();
    const push = first.getByRole("button", { name: "푸시", exact: true });
    if (await push.count()) {
      await push.click();
      await pl.getByText("푸시", { exact: true }).first().waitFor();
      pushed = true;
      // 푸시한 굴림(맨 위 항목)에는 행운도 푸시도 붙지 않는다
      await pl.waitForTimeout(250);
      const top = pl.getByTestId("roll-entry").first();
      assert.equal(await top.getByRole("button", { name: /행운 \d+ 쓰기|^푸시$/ }).count(), 0);
    }
  }
  assert.ok(pushed, "40번 안에 실패가 나오지 않았어요");
  step("실패한 시트 판정을 푸시하면 다시 굴린 결과가 로그에 남음");

  let spent = false;
  for (let i = 0; i < 60 && !spent; i++) {
    const first = await rollSkill();
    const luck = first.getByRole("button", { name: /행운 \d+ 쓰기/ });
    if ((await luck.count()) && (await luck.isEnabled())) {
      await luck.click();
      await pl.getByText("행운", { exact: true }).first().waitFor();
      spent = true;
    }
  }
  assert.ok(spent, "행운을 쓸 수 있는 실패가 나오지 않았어요");
  step("행운을 쓰면 실패가 성공으로 바뀐 결과가 로그에 남음");

  // 전투(격투) 판정은 실패해도 푸시 버튼이 없고 이유가 한 줄로 나온다
  let combatChecked = false;
  for (let i = 0; i < 40 && !combatChecked; i++) {
    const entries = pl.getByTestId("roll-entry");
    const before = await entries.count();
    await sheetTab(pl);
    await pl.getByRole("button", { name: "맨손 격투 굴리기" }).click();
    await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
    await pl.waitForFunction((n) => document.querySelectorAll('[data-testid="roll-entry"]').length > n, before);
    await pl.waitForTimeout(250);
    const top = entries.first();
    if (await top.locator('[data-level="failure"]').count()) {
      assert.equal(await top.getByRole("button", { name: "푸시", exact: true }).count(), 0);
      await top.getByTestId("rule-note").getByText("전투").waitFor();
      combatChecked = true;
    }
  }
  assert.ok(combatChecked, "격투 실패가 나오지 않았어요");
  step("전투 판정은 푸시 버튼이 없고 이유가 보임");

  // 광기: GM이 상태를 지정하면 PL 시트에 표시, 증상표에서 굴리면 주인과 GM만 본다
  await openSettings(kp);
  await kp.getByRole("button", { name: "광기표", exact: true }).click();
  await kp.getByLabel("증상 목록").fill("공포에 얼어붙는다\n비명을 지르며 달아난다");
  await kp.getByRole("button", { name: "저장", exact: true }).click();
  await kp.keyboard.press("Escape");
  await sheetTab(kp);
  await kp.getByLabel("광기 상태").selectOption("temporary");
  await sheetTab(pl);
  await pl.getByTestId("madness-badge").getByText("일시적 광기").waitFor();
  assert.equal(await pl.getByLabel("광기 상태").count(), 0, "PL에게는 광기 지정 컨트롤이 없어야 함");
  await kp.getByRole("button", { name: "증상 굴리기(요약)" }).click();
  await kp.getByRole("dialog", { name: "광기 증상" }).waitFor();
  const symptom = await pl.getByTestId("madness-symptom").innerText();
  assert.ok(["공포에 얼어붙는다", "비명을 지르며 달아난다"].includes(symptom));
  await kp.keyboard.press("Escape");
  await pl.keyboard.press("Escape");
  await kp.getByLabel("광기 상태").selectOption("none");
  await pl.getByTestId("madness-badge").waitFor({ state: "detached" });
  await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
  await closeSheet(kp); await kp.getByRole("tab", { name: "굴림" }).click();
  step("광기 상태 표시, 증상 굴림은 주인과 GM에게만, 해제하면 사라짐");

  // 판정 요청: GM이 요청하면 PL 화면에 배너가 뜨고, 누르면 내 캐릭터로 굴려짐
  await openAsk(kp);
  await kp.getByLabel("요청할 기능").fill("도서관 이용");
  await kp.getByRole("button", { name: "요청 보내기" }).click();
  const askBanner = pl.getByTestId("roll-ask-banner");
  await askBanner.getByText("도서관 이용").waitFor();
  await askBanner.getByRole("button", { name: "굴리기" }).click();
  await askBanner.waitFor({ state: "detached" });
  await pl.getByTestId("roll-entry").getByText(`${CHAR} · 도서관 이용`).first().waitFor();
  step("GM이 판정을 요청하면 PL에게 배너가 뜨고, 굴리기를 누르면 내 캐릭터로 굴림");

  // 탭 목록은 화살표 키로 옮길 수 있다
  await pl.getByRole("tab", { name: "굴림" }).focus();
  await pl.keyboard.press("ArrowRight");
  await pl.getByRole("tab", { name: "시트", selected: true }).waitFor();
  await pl.keyboard.press("ArrowLeft");
  await pl.getByRole("tab", { name: "굴림", selected: true }).waitFor();
  step("탭 목록이 화살표 키로 움직임");

  // 무기·상태·소지품
  await sheetTab(pl);
  await pl.getByTestId("weapons").getByText("주먹").waitFor();
  await pl.getByRole("button", { name: "주먹 피해" }).click();
  await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click(); // 시트에서 굴려도 탭이 바뀌지 않으니 기록을 보려면 굴림 탭으로 간다
  await pl.getByTestId("roll-entry").getByText(`${CHAR} · 주먹 피해`).first().waitFor();
  await sheetTab(pl);
  // 상태 표시는 GM만 바꾼다: PL 시트에는 토글이 없고, GM이 켜면 PL 시트에 칩으로 보인다
  assert.equal(await pl.getByTestId("conditions").count(), 0, "PL은 상태 표시를 직접 바꿀 수 없어요");
  await sheetTab(kp);
  await kp.getByTestId("conditions").getByRole("button", { name: "중상" }).click();
  await kp.getByTestId("conditions").getByRole("button", { name: "중상", pressed: true }).waitFor();
  await pl.getByTestId("sheet-status").getByTestId("status-chips").getByText("중상").waitFor();
  assert.equal(await kp.getByLabel("소지품").inputValue(), "손전등");
  await kp.getByTestId("conditions").getByRole("button", { name: "중상" }).click();
  await kp.getByTestId("conditions").getByRole("button", { name: "중상", pressed: false }).waitFor();
  await pl.getByTestId("status-chips").getByText("중상").waitFor({ state: "detached" });
  await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
  await closeSheet(kp); await kp.getByRole("tab", { name: "굴림" }).click();
  step("무기 피해 굴림이 로그에 남고, 중상 표시는 GM만 바꾸며 PL 시트에는 칩으로 보이고, 소지품이 GM 시트에 반영됨");

  // 주사위 식: (2d6+6)*5 처럼 괄호·곱셈을 쓰고, 항별 결과가 로그에 남는다. 잘못된 식은 한국어로 거절한다
  {
    const expr = pl.getByLabel("굴림 식");
    const cnt0 = await pl.getByTestId("roll-entry").count();
    await expr.fill("(2d6+6)*5");
    await pl.getByRole("button", { name: "굴리기", exact: true }).click();
    await pl.waitForFunction((n) => document.querySelectorAll('[data-testid="roll-entry"]').length > n, cnt0);
    const entry = pl.getByTestId("roll-entry").first();
    await entry.getByTestId("dice-total").waitFor();
    const total = Number(await entry.getByTestId("dice-total").innerText());
    assert.ok(total % 5 === 0 && total >= 40 && total <= 90, `(2d6+6)*5 결과 범위: ${total}`);
    assert.match(await entry.getByTestId("dice-breakdown").innerText(), /^\(2d6\[\d,\d\]\+6\)\*5$/);
    assert.equal(await entry.getByTestId("dice-term").count(), 1);
    await kp.getByTestId("roll-entry").first().getByTestId("dice-total").waitFor(); // GM 로그에도 같은 항목
    // 1d10+db: 내 캐릭터의 피해 보너스가 항으로 더해진다
    await expr.fill("1d10+db");
    await pl.getByRole("button", { name: "굴리기", exact: true }).click();
    await pl.waitForFunction((n) => document.querySelectorAll('[data-testid="roll-entry"]').length > n, cnt0 + 1);
    await pl.getByTestId("roll-entry").first().getByTestId("dice-term").filter({ hasText: /^db\(/ }).waitFor();
    // 잘못된 식은 보내기 전에 알려 주고, 로그에 남지 않는다
    const before = await pl.getByTestId("roll-entry").count();
    await expr.fill("2d6+");
    await pl.getByRole("button", { name: "굴리기", exact: true }).click();
    await pl.getByTestId("roll-expr-error").getByText(/식을 읽지 못했어요/).waitFor();
    await expr.fill("1001d6");
    await pl.getByRole("button", { name: "굴리기", exact: true }).click();
    await pl.getByTestId("roll-expr-error").getByText(/1000개까지/).waitFor();
    // 클라이언트가 막지 못하는 계산 중 오류(결과가 너무 큼)는 서버가 한국어로 거절한다
    await expr.fill("1000d6*1000000");
    await pl.getByRole("button", { name: "굴리기", exact: true }).click();
    await pl.getByTestId("toast").getByText(/결과가 너무 커요/).waitFor();
    assert.equal(await pl.getByTestId("roll-entry").count(), before);
    await expr.fill("");
  }
  step("주사위 식: (2d6+6)*5와 1d10+db가 항별 결과와 함께 로그에 남고, 잘못된 식은 한국어로 거절됨");

  // 핸드아웃: 초안 → 특정 PL에게 공개 → 다시 초안
  await closeSheet(kp); await kp.getByRole("tab", { name: "핸드아웃" }).click();
  await kp.getByRole("button", { name: "새 핸드아웃" }).click();
  await kp.getByLabel("핸드아웃 제목").fill("낡은 편지");
  await kp.getByLabel("핸드아웃 내용").fill("자정에 서재로 와 주게.");
  await kp.getByLabel("공개 범위").selectOption("pick");
  await kp.getByLabel("서하", { exact: true }).check();
  await kp.getByRole("button", { name: "저장", exact: true }).click();
  await kp.getByTestId("handout-item").getByText("낡은 편지").waitFor();
  await pl.getByTestId("handout-new").waitFor(); // 핸드아웃 탭을 안 보는 PL에게 새 핸드아웃 표시
  await closeSheet(pl); await pl.getByRole("tab", { name: "핸드아웃" }).click();
  await pl.getByTestId("handout-new").waitFor({ state: "detached" });
  await pl.getByTestId("handout-item").getByText("낡은 편지").waitFor();
  await pl.getByTestId("handout-item").getByText("낡은 편지").click();
  await pl.getByText("자정에 서재로 와 주게.").waitFor();
  step("GM이 공개한 핸드아웃이 PL에게 나타나고 내용을 읽을 수 있음");

  await kp.getByRole("button", { name: "펼쳐 보이기" }).click();
  await pl.getByRole("dialog", { name: "핸드아웃" }).getByText("자정에 서재로 와 주게.").waitFor();
  // 대화상자: 초점이 안으로 들어오고, Tab을 계속 눌러도 밖으로 나가지 않는다
  assert.equal(await pl.getByRole("dialog", { name: "핸드아웃" }).getAttribute("aria-modal"), "true");
  for (let i = 0; i < 4; i++) {
    await pl.keyboard.press("Tab");
    assert.equal(await pl.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), true);
  }
  await pl.getByRole("dialog").getByRole("button", { name: "닫기" }).click();
  assert.equal(await pl.getByRole("dialog").count(), 0);
  step("GM이 펼쳐 보이면 PL 화면 가운데에 핸드아웃이 뜨고 닫을 수 있음");

  await kp.getByRole("button", { name: "편집" }).click();
  await kp.getByLabel("공개 범위").selectOption("gm");
  await kp.getByRole("button", { name: "저장", exact: true }).click();
  await pl.getByTestId("handout-item").waitFor({ state: "detached" });
  step("초안으로 되돌리면 PL 화면에서 사라짐");

  // 초안 핸드아웃: 펼쳐 보이기가 막힌 이유를 알려 주고, ‘공개하기’ 한 번으로 전원 공개 + 펼쳐 보이기
  {
    const item = kp.getByTestId("handout-item").filter({ hasText: "낡은 편지" });
    await item.getByTestId("handout-show-why").waitFor(); // PL 화면이 먼저 바뀌어도 GM 화면이 따라올 때까지 기다린다
    assert.equal(await item.getByRole("button", { name: "펼쳐 보이기" }).isDisabled(), true);
    assert.match(await item.getByTestId("handout-show-why").innerText(), /공개하기/);
    assert.match((await item.getByRole("button", { name: "펼쳐 보이기" }).getAttribute("aria-describedby")) ?? "", /^handout-why-/);
    await item.getByTestId("handout-publish").click();
    await pl.getByRole("dialog", { name: "핸드아웃" }).getByText("자정에 서재로 와 주게.").waitFor();
    await pl.keyboard.press("Escape");
    await item.getByText("전원").waitFor();
    assert.equal(await item.getByTestId("handout-publish").count(), 0);
    await item.getByRole("button", { name: "편집" }).click();
    await kp.getByLabel("공개 범위").selectOption("gm");
    await kp.getByRole("button", { name: "저장", exact: true }).click();
    await pl.getByTestId("handout-item").waitFor({ state: "detached" });
  }
  step("초안은 펼쳐 보이기가 막힌 이유가 보이고, 공개하기 한 번으로 전원 공개와 펼쳐 보이기가 됨");
  await closeSheet(kp); await kp.getByRole("tab", { name: "굴림" }).click();
  await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();


  // 새 토큰의 소유자 기본값은 "소유자 없음(NPC)": 이름을 비워도 PL 이름이 붙지 않고, PL은 그 토큰을 움직일 수 없다
  assert.equal(await kp.getByLabel("새 토큰 소유자").inputValue(), "");
  await kp.getByRole("button", { name: "+ 토큰" }).click();
  await pl.locator('[data-testid^="obj-토큰"]').first().waitFor();
  assert.equal(await pl.getByTestId("obj-서하").count(), 0, "소유자 없는 토큰에 PL 이름이 붙으면 안 돼요");
  {
    const npcId = await pl.locator('[data-testid^="obj-토큰"]').first().getAttribute("data-testid");
    const npc = pl.getByTestId(npcId);
    const x0 = await npc.getAttribute("data-x");
    assert.notEqual(await npc.getAttribute("data-mine"), "true");
    const nb = await npc.locator("circle").first().boundingBox();
    await pl.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
    await pl.mouse.down();
    await pl.mouse.move(nb.x + nb.width / 2 + 100, nb.y + nb.height / 2 + 40, { steps: 5 });
    await pl.mouse.up();
    await pl.waitForTimeout(700);
    assert.equal(await kp.getByTestId(npcId).getAttribute("data-x"), x0, "PL이 소유자 없는 토큰을 움직였어요");
    assert.equal(await pl.getByTestId(npcId).getAttribute("data-x"), x0);
    await kp.getByTestId(npcId).click();
    await kp.getByRole("button", { name: "삭제", exact: true }).click();
    await pl.getByTestId(npcId).waitFor({ state: "detached" });
  }
  step("새 토큰 소유자 기본값은 소유자 없음(NPC): 이름이 PL 이름이 아니고 PL은 움직일 수 없음");

  // GM이 토큰을 만들고 PL이 받음
  await kp.getByLabel("새 토큰 소유자").selectOption({ label: "서하" });
  await kp.getByRole("button", { name: "+ 토큰" }).click();
  await pl.getByTestId("obj-서하").waitFor();
  step("GM이 만든 토큰이 PL 화면에 나타남");

  // 이미지 업로드: 토큰 이미지, 장면 배경, 핸드아웃 이미지
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const file = { name: "pic.png", mimeType: "image/png", buffer: PNG };
  await kp.getByTestId("obj-서하").click();
  await kp.getByLabel("이미지 파일").setInputFiles(file);
  const tokenImg = pl.getByTestId("img-서하");
  await tokenImg.waitFor();
  const href = await tokenImg.getAttribute("href");
  const got = await fetch(href);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/png");
  await openSceneMenu(kp);
  await kp.getByLabel("배경 파일").setInputFiles(file);
  await pl.getByTestId("board-bg").waitFor();
  await kp.getByRole("button", { name: "배경 떼기" }).click();
  await kp.keyboard.press("Escape");
  await pl.getByTestId("board-bg").waitFor({ state: "detached" });
  await kp.getByTestId("obj-서하").click();
  await kp.getByRole("button", { name: "이미지 떼기" }).click();
  await pl.getByTestId("img-서하").waitFor({ state: "detached" });
  await closeSheet(kp); await kp.getByRole("tab", { name: "핸드아웃" }).click();
  await kp.getByRole("button", { name: "새 핸드아웃" }).click();
  await kp.getByLabel("핸드아웃 제목").fill("사진 한 장");
  await kp.getByLabel("이미지 넣기 파일").setInputFiles(file);
  await kp.getByAltText("핸드아웃 이미지 미리보기").waitFor();
  await kp.getByLabel("공개 범위").selectOption("all");
  await kp.getByRole("button", { name: "저장", exact: true }).click();
  await closeSheet(pl); await pl.getByRole("tab", { name: "핸드아웃" }).click();
  await pl.getByTestId("handout-item").getByText("사진 한 장").click();
  await pl.getByAltText("사진 한 장 이미지").waitFor();
  await kp.getByTestId("handout-item").getByRole("button", { name: "삭제" }).first().waitFor();
  await kp.getByTestId("handout-item").filter({ hasText: "사진 한 장" }).getByRole("button", { name: "삭제" }).click();
  await confirmAsk(kp);
  await pl.getByTestId("handout-item").waitFor({ state: "detached" });
  await closeSheet(kp); await kp.getByRole("tab", { name: "굴림" }).click();
  await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
  step("이미지 업로드: 토큰·장면 배경·핸드아웃 이미지가 PL 화면에 나타나고 떼면 사라짐");

  // PL이 자기 토큰을 끌어서 이동
  const token = pl.getByTestId("obj-서하");
  const box = await token.locator("circle").first().boundingBox();
  await pl.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pl.mouse.down();
  await pl.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 6 });
  await pl.mouse.up();
  await kp.waitForFunction(() => {
    const el = document.querySelector('[data-testid="obj-서하"]');
    return el && Number(el.getAttribute("data-x")) > 500;
  });
  step("PL이 끈 토큰이 GM 화면에서 움직임");

  // 핑: PL이 Alt+클릭하면 GM 화면에 파동과 이름표가 잠시 뜬다(PL 화면에도 보인다)
  {
    const bb = await pl.getByTestId("board").boundingBox();
    await pl.keyboard.down("Alt");
    await pl.mouse.click(bb.x + bb.width * 0.75, bb.y + bb.height * 0.25);
    await pl.keyboard.up("Alt");
    await kp.getByTestId("ping").waitFor();
    assert.match(await kp.getByTestId("ping").textContent(), /서하/);
    await pl.getByTestId("ping").waitFor();
    await pl.screenshot({ path: `${SHOTS}/ping-pl.png` });
    await kp.screenshot({ path: `${SHOTS}/ping-kp.png` });
    await kp.getByTestId("ping").waitFor({ state: "detached" });
  }
  step("PL이 Alt+클릭으로 가리키면 GM 화면에 이름표 달린 핑이 잠시 뜨고 사라짐");

  // 키보드만으로: 건너뛰기 링크로 보드에 가고, 숨은 토큰 목록에서 토큰을 골라 방향키로 움직임
  {
    const x0 = Number(await kp.getByTestId("obj-서하").getAttribute("data-x"));
    await pl.getByTestId("skip-to-board").focus();
    await pl.keyboard.press("Enter");
    assert.equal(await pl.evaluate(() => document.activeElement?.getAttribute("data-testid")), "board");
    await pl.getByTestId("pick-서하").focus();
    await pl.keyboard.press("Enter");
    assert.equal(await pl.evaluate(() => document.activeElement?.getAttribute("data-testid")), "board");
    await pl.keyboard.press("ArrowRight");
    await kp.waitForFunction((x) => Number(document.querySelector('[data-testid="obj-서하"]')?.getAttribute("data-x")) > x, x0);
  }
  step("키보드만으로 보드로 건너뛰고, 토큰 목록에서 골라 방향키로 움직임");
  // 건너뛰기 링크 둘: 패널로 건너뛰면 굴림 입력까지 Tab 12번 안에 닿는다
  {
    await pl.getByRole("tab", { name: /^굴림/ }).click();
    await pl.reload();
    await pl.getByTestId("board").waitFor();
    await pl.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
    let presses = 0;
    const active = () => pl.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.getAttribute("aria-label") ?? "");
    await pl.keyboard.press("Tab"); presses++;
    assert.equal(await active(), "skip-to-board");
    await pl.keyboard.press("Tab"); presses++;
    assert.equal(await active(), "skip-to-panel");
    assert.equal(await pl.getByRole("link", { name: "패널로 건너뛰기" }).isVisible(), true, "초점이 오면 링크가 보여요");
    await pl.keyboard.press("Enter"); presses++;
    assert.equal(await pl.evaluate(() => document.activeElement?.getAttribute("role")), "tab");
    await pl.keyboard.press("Tab"); presses++;
    assert.equal(await pl.evaluate(() => Boolean(document.activeElement?.getAttribute("role") !== "tab" && document.activeElement?.closest('[data-testid="side-panel"]'))), true, "탭 다음 Tab 이 패널 안으로 들어가야 해요");
    assert.ok(presses <= 12, `패널까지 키 ${presses}번`);
    // 굴림 입력 자체까지의 번호는 굴림 기록 길이에 따라 달라지므로 참고용으로만 남긴다
    console.log(`  (패널 진입까지 키 ${presses}번)`);
    // 9개 슬롯은 한 번의 Tab 으로 지나간다(화살표로 이동)
    await kp.keyboard.press("Escape");
    step(`패널로 건너뛰기: 건너뛰기 링크 포함 키 ${presses}번 안에 굴림 입력에 닿음`);
  }

  // GM 전용 오브젝트는 PL에게 안 보임
  await kp.getByRole("button", { name: "+ GM 전용" }).click();
  await kp.getByTestId("obj-숨김 소품2").waitFor();
  await pl.waitForTimeout(400);
  assert.equal(await pl.getByTestId("obj-숨김 소품2").count(), 0);
  step("GM 전용 오브젝트는 PL 화면에 없음");

  // 시트→토큰: GM이 시트 탭에서 "토큰으로 놓기"를 누르면 그 캐릭터 이름·소유자로 토큰이 생긴다
  await sheetTab(kp);
  await kp.getByRole("button", { name: "토큰으로 놓기" }).click();
  await pl.getByTestId(`obj-${CHAR}`).waitFor();
  assert.equal(await pl.getByTestId(`obj-${CHAR}`).getAttribute("data-mine"), "true");
  await closeSheet(kp); await kp.getByRole("tab", { name: "굴림" }).click();
  step("시트 탭의 '토큰으로 놓기'로 캐릭터 이름·소유자 토큰이 생기고 그 PL 화면에서 '나'로 표시됨");

  // 안개와 시야: 안개 속 오브젝트는 PL 화면에서 아예 사라지고, 시야·밝힌 영역으로 다시 보임
  await kp.getByRole("button", { name: "+ 소품" }).click();
  const plProps = pl.locator('[data-testid^="obj-소품"]');
  await plProps.first().waitFor();
  await dockTab(kp, "fog");
  await kp.getByRole("button", { name: "안개 켜기" }).click();
  await pl.getByTestId("fog").waitFor();
  await plProps.first().waitFor({ state: "detached" });
  await pl.getByTestId("obj-서하").waitFor();
  await kp.getByTestId("obj-서하").click();
  await openFogMore(kp);
  await kp.getByLabel("시야 반지름").fill("400");
  await kp.getByRole("button", { name: "시야 주기", exact: true }).click();
  await plProps.first().waitFor();
  await kp.getByRole("button", { name: "시야 없애기" }).click();
  await plProps.first().waitFor({ state: "detached" });
  await kp.getByLabel("밝힐 반지름").fill("600");
  await kp.getByRole("button", { name: "영역 밝히기" }).click();
  const bb = await kp.getByTestId("board").boundingBox();
  await kp.mouse.click(bb.x + bb.width / 2 - 100, bb.y + bb.height / 2 - 100);
  await kp.getByTestId("fog-zones").getByText("밝힌 영역 1").waitFor();
  await plProps.first().waitFor();
  await kp.getByRole("button", { name: "보드를 눌러 밝히는 중…" }).click();
  await kp.getByRole("button", { name: "영역 모두 지우기" }).click();
  await plProps.first().waitFor({ state: "detached" });
  // 탐험 기록: 시야가 지나간 자리는 지금 안 보여도 기록으로 남고, GM이 지울 수 있다
  await pl.getByTestId("fog-explored").waitFor();
  await kp.getByTestId("fog-explored-count").getByText(/탐험 기록 [1-9]/).waitFor();
  await kp.getByRole("button", { name: "탐험 기록 지우기" }).click();
  await kp.getByTestId("fog-explored-count").getByText("탐험 기록 0").waitFor();
  await pl.getByTestId("fog-explored").waitFor({ state: "detached" });
  await plProps.first().waitFor({ state: "detached" });
  await kp.getByRole("button", { name: "안개 끄기" }).click();
  await plProps.first().waitFor();
  await pl.getByTestId("fog").waitFor({ state: "detached" });
  await dockTab(kp, "place");
  step("안개와 시야: 안개 속 오브젝트는 PL 화면에서 사라지고, 시야 반지름·밝힌 영역으로 다시 보이며, 지나간 자리는 탐험 기록으로 남고(GM이 지움), 끄면 모두 보임");

  // 되돌리기(Ctrl+Z): 토큰 삭제 → 복귀, 이동 → 원위치. 확인창 없이 삭제하고 안내 토스트가 뜬다.
  const undoTok = kp.getByTestId("obj-숨김 소품2");
  await undoTok.click();
  await kp.getByRole("button", { name: "삭제", exact: true }).click();
  await undoTok.waitFor({ state: "detached" });
  await kp.getByTestId("toast").getByText(/되돌리려면 Ctrl\+Z/).first().waitFor();
  await kp.keyboard.press("Control+z");
  await undoTok.waitFor();
  await kp.getByTestId("toast").getByText(/되돌렸어요/).waitFor();
  const x0 = Number(await undoTok.getAttribute("data-x"));
  const ub = await undoTok.locator("circle").first().boundingBox();
  await kp.mouse.move(ub.x + ub.width / 2, ub.y + ub.height / 2);
  await kp.mouse.down();
  await kp.mouse.move(ub.x + ub.width / 2 + 100, ub.y + ub.height / 2 + 40, { steps: 6 });
  await kp.mouse.up();
  await kp.waitForFunction((x) => Math.abs(Number(document.querySelector('[data-testid="obj-숨김 소품2"]')?.getAttribute("data-x")) - x) > 20, x0);
  await kp.keyboard.press("Control+z");
  await kp.waitForFunction((x) => Number(document.querySelector('[data-testid="obj-숨김 소품2"]')?.getAttribute("data-x")) === x, x0);
  // 되돌릴 기록이 더는 없으면(직접 눌러 확인) 오류 토스트. 버튼으로도 되돌릴 수 있다.
  step("되돌리기: GM 토큰 삭제 뒤 Ctrl+Z 로 복귀하고, 이동도 Ctrl+Z 로 원위치");

  // 보드 단축키·오른쪽 클릭 메뉴: Backspace 삭제 + Ctrl+Z, Ctrl+D 복제, Esc 선택 해제, Tab 이동, 메뉴 항목
  {
    const sel = kp.getByTestId("selected-bar");
    const selName = () => sel.getByLabel("선택한 토큰·소품 이름").inputValue();
    await undoTok.click();
    await kp.keyboard.press("Backspace");
    await undoTok.waitFor({ state: "detached" });
    await kp.getByTestId("toast").getByText(/되돌리려면 Ctrl\+Z/).first().waitFor();
    assert.equal(await sel.count(), 0); // 지우면 선택도 풀린다
    await kp.keyboard.press("Control+z");
    await undoTok.waitFor();
    step("Backspace 로 선택한 오브젝트를 지우면 안내 토스트가 뜨고 Ctrl+Z 로 돌아옴");

    // 글을 쓰는 칸에서는 Backspace 가 오브젝트를 지우지 않는다
    await undoTok.click();
    await kp.getByLabel("굴림 식").focus();
    await kp.keyboard.press("Backspace");
    await kp.waitForTimeout(250);
    assert.equal(await undoTok.count(), 1);
    await undoTok.click(); // 포커스를 보드로

    // Ctrl+D 복제: 새 이름으로 생기고 복제본이 선택된다
    await kp.keyboard.press("Control+d");
    const copy = kp.getByTestId("obj-숨김 소품2 2");
    await copy.waitFor();
    await kp.waitForFunction(() => document.querySelector('[data-testid="selected-bar"] input')?.value === "숨김 소품2 2");
    assert.equal(await copy.getAttribute("data-x") !== await undoTok.getAttribute("data-x"), true);
    step("Ctrl+D 로 복제하면 이름에 번호가 붙고 복제본이 선택됨");

    // 오른쪽 클릭 메뉴: 이름 바꾸기, 보이기/숨기기(PL 화면과 맞춰 봄), 삭제 + 되돌리기
    await copy.click({ button: "right" });
    const menu = kp.getByTestId("object-menu");
    await menu.waitFor();
    await kp.screenshot({ path: `${SHOTS}/ctx-menu.png` });
    await menu.getByRole("menuitem", { name: "이름 바꾸기" }).click();
    await menu.getByLabel("새 이름").fill("메뉴 시험");
    await kp.keyboard.press("Enter");
    const tested = kp.getByTestId("obj-메뉴 시험");
    await tested.waitFor();
    await menu.waitFor({ state: "detached" });
    assert.equal(await pl.getByTestId("obj-메뉴 시험").count(), 0); // 숨김 오브젝트라 PL 에게는 안 보인다
    await tested.click({ button: "right" });
    await kp.getByRole("menuitem", { name: "보이기" }).click();
    await pl.getByTestId("obj-메뉴 시험").waitFor();
    await tested.click({ button: "right" });
    await kp.getByRole("menuitem", { name: "숨기기" }).click();
    await pl.getByTestId("obj-메뉴 시험").waitFor({ state: "detached" });
    await tested.click({ button: "right" });
    await kp.getByRole("menuitem", { name: "삭제" }).click();
    await tested.waitFor({ state: "detached" });
    await kp.getByTestId("toast").getByText(/되돌리려면 Ctrl\+Z/).first().waitFor();
    await kp.keyboard.press("Control+z");
    await tested.waitFor();
    // 메뉴가 열려 있는 동안에는 Delete 가 먹지 않고, Esc 는 메뉴만 닫는다
    await tested.click({ button: "right" });
    await kp.keyboard.press("Delete");
    await kp.waitForTimeout(250);
    assert.equal(await tested.count(), 1);
    await kp.keyboard.press("Escape");
    await kp.getByTestId("object-menu").waitFor({ state: "detached" });
    assert.equal(await sel.count(), 1);
    // 복제(메뉴)와 잠금(토큰)
    const seo = kp.getByTestId("obj-서하");
    await seo.click({ button: "right" });
    await kp.getByRole("menuitem", { name: "잠금", exact: true }).click();
    await kp.locator('[data-testid="obj-서하"][data-locked="true"]').waitFor();
    await seo.click({ button: "right" });
    await kp.getByRole("menuitem", { name: "잠금 해제" }).click();
    await kp.locator('[data-testid="obj-서하"]:not([data-locked])').waitFor();
    // 오른쪽 클릭으로는 토큰이 끌려 다니지 않는다
    assert.equal(await sel.count(), 1);
    // 정리: 시험용 오브젝트를 지운다
    await tested.click();
    await kp.keyboard.press("Delete");
    await tested.waitFor({ state: "detached" });
    step("오른쪽 클릭 메뉴: 이름 바꾸기·보이기/숨기기·잠금/해제·삭제(Ctrl+Z 복구), 메뉴가 열려 있으면 단축키 무시");

    // Esc 로 선택 해제, Tab 으로 토큰 사이 이동(고른 것이 있을 때만 가로챔)
    await seo.click();
    assert.equal(await selName(), "서하");
    await kp.keyboard.press("Tab");
    await sel.waitFor();
    assert.ok((await selName()).length > 0);
    await kp.keyboard.press("Shift+Tab");
    await kp.waitForFunction(() => document.querySelector('[data-testid="selected-bar"] input')?.value === "서하");
    await kp.keyboard.press("Escape");
    await sel.waitFor({ state: "detached" });
    step("Esc 로 선택이 풀리고, Tab/Shift+Tab 으로 토큰 사이를 오감");
  }

  // 이미지 넣기: 끌어다 놓기·붙여넣기·이미지 고르기(다시 쓰기)·빈 상태 안내·핸드아웃 끌어놓기
  {
    const makePng = (name, color) =>
      `(() => { const c = document.createElement("canvas"); c.width = c.height = 8; const g = c.getContext("2d"); g.fillStyle = ${JSON.stringify(color)}; g.fillRect(0, 0, 8, 8);
        return new Promise((res) => c.toBlob((b) => res(new File([b], ${JSON.stringify(name)}, { type: "image/png" })), "image/png")); })()`;
    // 브라우저 안에서 PNG 를 만들어 보드에 끌어다 놓거나 붙여 넣는다(실제 파일 끌기를 흉내 냄)
    const dropOnBoard = (page, name, color, at) =>
      page.evaluate(async ({ mk, at }) => {
        const file = await eval(mk);
        const dt = new DataTransfer();
        dt.items.add(file);
        const board = document.querySelector('[data-testid="board"]');
        const r = board.getBoundingClientRect();
        const clientX = r.left + r.width * at[0];
        const clientY = r.top + r.height * at[1];
        for (const type of ["dragenter", "dragover", "drop"]) board.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX, clientY }));
      }, { mk: makePng(name, color), at });
    const dropOnPoint = (page, name, color, x, y) =>
      page.evaluate(async ({ mk, x, y }) => {
        const file = await eval(mk);
        const dt = new DataTransfer();
        dt.items.add(file);
        const board = document.querySelector('[data-testid="board"]');
        for (const type of ["dragenter", "dragover", "drop"]) board.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
      }, { mk: makePng(name, color), x, y });
    let uploads = 0;
    kp.on("request", (r) => r.method() === "POST" && /\/images$/.test(r.url()) && uploads++);

    // 배경이 비어 있으면 한 줄 안내가 보이고, 이미지 없는 선택 토큰에는 '이미지 올리기' 칩이 뜬다
    const hint = kp.getByTestId("board-hint");
    await hint.waitFor();
    assert.match(await hint.textContent(), /끌어다 놓아 배경/);
    await kp.getByTestId("obj-서하").click();
    await kp.getByTestId("add-image-chip").waitFor();
    await kp.screenshot({ path: `${SHOTS}/img-hint-chip.png` });
    await kp.keyboard.press("Escape");
    await kp.getByTestId("add-image-chip").waitFor({ state: "detached" });

    // 빈 곳에 놓으면 쓰임을 묻는다 → 새 토큰으로
    await dropOnBoard(kp, "맨홀 뚜껑.png", "#c33", [0.9, 0.12]);
    const intake = kp.getByTestId("image-intake");
    await intake.waitFor();
    await kp.screenshot({ path: `${SHOTS}/img-intake.png` });
    assert.deepEqual(await intake.getByRole("menuitem").allInnerTexts(), ["배경으로", "새 토큰으로", "소품으로", "취소"]);
    await intake.getByRole("menuitem", { name: "새 토큰으로" }).click();
    const manhole = kp.getByTestId("obj-맨홀 뚜껑");
    await manhole.waitFor();
    await intake.waitFor({ state: "detached" });
    await pl.getByTestId("img-맨홀 뚜껑").waitFor();
    // 새로 만든 토큰이 선택된다
    await kp.waitForFunction(() => document.querySelector('[data-testid="selected-bar"] input')?.value === "맨홀 뚜껑");
    step("파일을 빈 보드에 끌어다 놓으면 쓰임을 묻고, 새 토큰으로 놓으면 PL 화면에도 그림이 보임");

    // 토큰 위에 놓으면 묻지 않고 그 토큰의 그림이 바뀐다
    const before = await pl.getByTestId("img-맨홀 뚜껑").getAttribute("href");
    const mb = await manhole.locator("circle").first().boundingBox();
    await dropOnPoint(kp, "다른 그림.png", "#36c", mb.x + mb.width / 2, mb.y + mb.height / 2);
    await kp.waitForFunction((h) => document.querySelector('[data-testid="img-맨홀 뚜껑"]')?.getAttribute("href") !== h, before);
    assert.equal(await kp.getByTestId("image-intake").count(), 0);
    step("토큰 위에 파일을 놓으면 바로 그 토큰의 이미지가 바뀜");

    // 배경으로
    await dropOnBoard(kp, "복도.png", "#363", [0.1, 0.9]);
    await kp.getByTestId("intake-background").click();
    await pl.getByTestId("board-bg").waitFor();
    await kp.getByTestId("board-hint").waitFor({ state: "detached" }); // 배경이 생기면 안내는 사라진다
    step("빈 곳에 놓고 '배경으로'를 고르면 장면 배경이 정해짐(안내 문구도 사라짐)");

    // 이미지 형식이 아니면 안내만 하고 아무것도 만들지 않는다
    await kp.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["hi"], "메모.txt", { type: "text/plain" }));
      const board = document.querySelector('[data-testid="board"]');
      for (const type of ["dragenter", "dragover", "drop"]) board.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 100, clientY: 400 }));
    });
    await kp.getByTestId("toast").getByText(/PNG, JPG, GIF, WEBP/).first().waitFor();
    assert.equal(await kp.getByTestId("image-intake").count(), 0);

    // 붙여넣기(클립보드 이미지): 같은 팝오버 → 소품으로
    await kp.getByTestId("board").focus();
    await kp.evaluate(async (mk) => {
      const file = await eval(mk);
      const dt = new DataTransfer();
      dt.items.add(file);
      document.activeElement.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
    }, makePng("image.png", "#c93"));
    await kp.getByTestId("image-intake").waitFor();
    await kp.keyboard.press("Escape"); // Esc 로 닫으면 아무것도 만들지 않는다
    await kp.getByTestId("image-intake").waitFor({ state: "detached" });
    await kp.getByTestId("board").focus();
    await kp.evaluate(async (mk) => {
      const file = await eval(mk);
      const dt = new DataTransfer();
      dt.items.add(file);
      document.activeElement.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
    }, makePng("열쇠.png", "#c93"));
    await kp.getByTestId("intake-prop").click();
    await kp.getByTestId("obj-열쇠").waitFor();
    await pl.getByTestId("img-열쇠").waitFor();
    // 글을 쓰는 칸에 붙여 넣을 때는 끼어들지 않는다
    await kp.getByLabel("굴림 식").focus();
    await kp.evaluate(async (mk) => {
      const file = await eval(mk);
      const dt = new DataTransfer();
      dt.items.add(file);
      document.activeElement.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
    }, makePng("무시.png", "#000"));
    await kp.waitForTimeout(250);
    assert.equal(await kp.getByTestId("image-intake").count(), 0);
    step("클립보드 이미지를 붙여 넣으면 같은 팝오버가 뜨고(Esc 로 취소), 소품으로 놓을 수 있음. 입력칸에서는 끼어들지 않음");

    // 이미지 고르기: 이 룸에서 쓴 이미지를 다시 고르면 새로 올리지 않는다
    const upBefore = uploads;
    await kp.getByTestId("obj-서하").click();
    await kp.getByRole("button", { name: "이미지", exact: true }).click();
    const picker = kp.getByTestId("image-picker");
    await picker.waitFor();
    assert.ok((await picker.getByTestId("image-thumb").count()) >= 3);
    await kp.screenshot({ path: `${SHOTS}/img-picker.png` });
    await picker.getByTestId("image-thumb").first().click();
    await pl.getByTestId("img-서하").waitFor();
    assert.equal(uploads, upBefore);
    // 오른쪽 클릭 메뉴의 '이미지 바꾸기'도 같은 목록을 쓴다
    await kp.getByTestId("obj-서하").click({ button: "right" });
    await kp.getByRole("menuitem", { name: "이미지 바꾸기" }).click();
    const pop = kp.getByTestId("object-image-pop");
    await pop.waitFor();
    await pop.getByTestId("image-thumb").nth(1).click();
    await pop.waitFor({ state: "detached" });
    assert.equal(uploads, upBefore);
    step("이미지 고르기: 이 룸에서 쓴 이미지를 다시 고르면 새로 올리지 않음(툴바·오른쪽 클릭 메뉴 모두)");

    // 핸드아웃 편집기의 이미지 칸에 끌어다 놓기
    await closeSheet(kp); await kp.getByRole("tab", { name: "핸드아웃" }).click();
    await kp.getByRole("button", { name: "새 핸드아웃" }).click();
    await kp.evaluate(async (mk) => {
      const file = await eval(mk);
      const dt = new DataTransfer();
      dt.items.add(file);
      const zone = document.querySelector('[data-testid="handout-image-drop"]');
      for (const type of ["dragenter", "dragover", "drop"]) zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, makePng("편지.png", "#eee"));
    await kp.getByAltText("핸드아웃 이미지 미리보기").waitFor();
    await kp.getByRole("button", { name: "취소" }).click();
    await closeSheet(kp); await kp.getByRole("tab", { name: "굴림" }).click();
    step("핸드아웃 편집기의 이미지 칸에 파일을 끌어다 놓으면 이미지가 들어감");

    // 정리: 시험용 오브젝트·배경·그림을 되돌려 놓는다
    for (const nm of ["맨홀 뚜껑", "열쇠"]) {
      await kp.getByTestId(`obj-${nm}`).click();
      await kp.keyboard.press("Backspace");
      await kp.getByTestId(`obj-${nm}`).waitFor({ state: "detached" });
    }
    await openSceneMenu(kp);
    await kp.getByRole("button", { name: "배경 떼기" }).click();
    await kp.keyboard.press("Escape");
    await pl.getByTestId("board-bg").waitFor({ state: "detached" });
    await kp.getByTestId("obj-서하").click();
    await kp.getByRole("button", { name: "이미지 떼기" }).click();
    await pl.getByTestId("img-서하").waitFor({ state: "detached" });
    await kp.keyboard.press("Escape");
  }

  // 굴림: 공개
  await pl.getByLabel("굴림 식").fill("CC<=60");
  await pl.getByRole("button", { name: "굴리기" }).click();
  await kp.getByTestId("roll-entry").first().waitFor();
  assert.match(await kp.getByTestId("roll-entry").first().innerText(), /서하/);
  step("PL의 굴림이 GM 로그에 보임");

  // 굴림: GM 비밀 굴림
  await kp.getByLabel(/비밀 굴림/).check();
  await kp.getByLabel("굴림 식").fill("1d100");
  await kp.getByRole("button", { name: "굴리기" }).click();
  await pl.getByTestId("roll-hidden").waitFor();
  assert.ok((await pl.getByTestId("roll-entry").count()) >= 3); // 시트 굴림 + SAN 체크 + CC 굴림(+ 푸시·행운 시도)
  assert.ok((await kp.getByTestId("roll-entry").count()) >= 4);
  step("GM 비밀 굴림: PL은 '했다'는 사실만 봄");

  // GM 접속 끊김 → 유예(배너, 입력은 계속 열림) → 유예 뒤 자동 정지 → GM이 돌아오면 자동 재개
  // (API는 KP_AWAY_GRACE_MS로 유예를 줄여 띄운다. 기본은 30초.)
  await kp.context().close();
  await pl.getByTestId("kp-away-banner").getByText("GM 연결이 끊겼어요. 잠시 기다려요.").waitFor();
  assert.equal(await pl.getByLabel("굴림 식").isDisabled(), false);
  assert.equal(await pl.getByTestId("session-status").getByText("진행 중").count(), 1);
  step("GM 연결이 끊기면 PL 화면에 '잠시 기다려요' 배너가 뜨고 아직 정지는 아님");
  await pl.getByText("세션이 일시정지 중이에요").first().waitFor();
  assert.equal(await pl.getByLabel("굴림 식").isDisabled(), true);
  assert.equal(await pl.getByTestId("kp-away-banner").count(), 0);
  step("유예가 지나도 GM이 안 오면 PL 화면이 일시정지로 바뀌고 입력이 막힘");

  const kp2 = await (await ctx()).newPage();
  await login(kp2, "하늘");
  await kp2.goto(roomUrl);
  await pl.getByTestId("session-status").getByText("진행 중").waitFor();
  assert.equal(await pl.getByLabel("굴림 식").isDisabled(), false);
  assert.equal(await kp2.getByRole("button", { name: "이어하기" }).count(), 0);
  step("GM이 돌아오면 이어하기 없이 자동 재개되어 PL 입력이 다시 열림");

  // 상태 표식: 오른쪽 클릭 메뉴로 켜면 PL 화면에도 보이고, "GM만 보임" 표식은 PL 화면에 없다
  {
    const tok = kp2.getByTestId("obj-서하");
    await tok.waitFor();
    await tok.click({ button: "right" });
    await kp2.getByTestId("menu-markers").click();
    await kp2.getByTestId("marker-toggle-stun").click();
    await pl.getByTestId("marker-서하-stun").waitFor();
    assert.match(await pl.getByTestId("marker-서하-stun").getAttribute("aria-label"), /기절/);
    // 비밀 표식: GM 화면에는 보이고 PL 화면에는 없다
    await kp2.getByTestId("marker-secret-switch").check();
    await kp2.getByTestId("marker-toggle-poison").click();
    await kp2.getByTestId("marker-서하-poison").waitFor();
    await kp2.getByTestId("marker-secret-switch").uncheck();
    await kp2.getByTestId("marker-toggle-bleed").click();
    await pl.getByTestId("marker-서하-bleed").waitFor();
    assert.equal(await pl.getByTestId("marker-서하-poison").count(), 0, "GM만 보이는 표식이 PL 화면에 있으면 안 돼요");
    assert.ok(!(await pl.content()).includes("marker-서하-poison"));
    await kp2.keyboard.press("Escape");
    await kp2.getByTestId("object-menu").waitFor({ state: "detached" });
    step("GM이 오른쪽 클릭 메뉴로 상태 표식을 켜면 PL 화면에 보이고, 'GM만 보임' 표식은 PL 화면에 없음");
  }

  // 관전: 관전 링크로 들어와 보기만 하고, 주인이 내보내면 끊긴다
  {
    await kp2.getByRole("button", { name: "초대", exact: true }).click();
    await kp2.getByTestId("invite-spectator-make").click();
    const specLink = await kp2.getByTestId("invite-spectator-link").inputValue();
    assert.match(specLink, /\/join\/.+\?invite=/);
    assert.notEqual(specLink, inviteLink);
    await kp2.keyboard.press("Escape");
    await kp2.getByRole("dialog").waitFor({ state: "detached" });

    const spec = await (await ctx()).newPage();
    await spec.goto(specLink);
    await spec.getByLabel("이름").fill("구경꾼");
    await spec.getByRole("button", { name: "계속하기" }).click();
    await spec.getByTestId("join-spectator-note").waitFor();
    await spec.getByTestId("join-enter").click();
    await spec.getByTestId("connection").getByText("연결됨").waitFor();
    await spec.getByTestId("spectator-badge").waitFor();
    await spec.getByTestId("obj-서하").waitFor();
    await spec.getByTestId("marker-서하-stun").waitFor();
    assert.equal(await spec.getByTestId("marker-서하-poison").count(), 0, "관전자에게도 GM만 보이는 표식은 없어요");
    assert.equal(await spec.getByRole("button", { name: "+ 토큰" }).count(), 0, "관전자에게 편집 도구가 보이면 안 돼요");
    assert.equal(await spec.getByTestId("spectator-count").count(), 0, "관전자 수는 GM에게만 보여요");
    assert.equal(await spec.getByTestId("request-token").count(), 0, "관전자에게는 토큰 요청 버튼이 없어요");
    assert.equal(await spec.getByRole("button", { name: "매크로 편집" }).count(), 0, "관전자에게는 매크로 편집이 없어요");
    assert.equal(await pl.getByTestId("spectator-count").count(), 0);
    assert.equal(await pl.getByTestId("spectator-badge").count(), 0);
    // 오른쪽 클릭 메뉴가 있어도 표식을 바꿀 수 없다
    await spec.getByTestId("obj-서하").click({ button: "right" });
    assert.equal(await spec.getByTestId("menu-markers").count(), 0);
    await spec.keyboard.press("Escape");
    await kp2.getByTestId("spectator-count").waitFor();
    step("관전 링크로 들어온 사람은 '관전 중'으로 보기만 하고(편집 도구 없음, 비밀 표식 없음) 관전자 수는 GM에게만 보임");

    // 주인이 내보낸다
    await kp2.getByRole("button", { name: "초대", exact: true }).click();
    await kp2.getByTestId("spectator-구경꾼").waitFor();
    await kp2.getByTestId("spectator-remove-구경꾼").click();
    if (await kp2.getByTestId("ask-dialog").count()) await confirmAsk(kp2);
    await kp2.getByTestId("spectator-empty").waitFor();
    await spec.getByText(/내보냈|내보내/).first().waitFor();
    await kp2.keyboard.press("Escape");
    await spec.close();
    step("룸 주인이 관전자를 내보내면 목록에서 사라지고 관전자 화면이 끊김");
  }

  // GM이 직접 누른 일시정지: 정지 중에도 GM은 토큰을 놓을 수 있고(굴림은 막힘), 새로고침해도 자동 재개되지 않음
  await kp2.getByTestId("connection").getByText("연결됨").waitFor();
  await kp2.getByRole("button", { name: "일시정지", exact: true }).click();
  await pl.getByText("세션이 일시정지 중이에요").first().waitFor();
  assert.equal(await kp2.getByRole("button", { name: "+ 토큰" }).isDisabled(), false);
  assert.equal(await kp2.getByLabel("굴림 식").isDisabled(), true);
  const tokensBefore = await kp2.locator('[data-testid^="obj-"]').count();
  await kp2.getByRole("button", { name: "+ 토큰" }).click();
  await kp2.waitForFunction((n) => document.querySelectorAll('[data-testid^="obj-"]').length > n, tokensBefore);
  await kp2.getByTestId("session-status").getByText("일시정지").waitFor();
  await kp2.reload();
  await kp2.getByTestId("connection").getByText("연결됨").waitFor();
  await kp2.getByRole("button", { name: "이어하기" }).waitFor();
  await kp2.waitForTimeout(800);
  assert.equal(await pl.getByTestId("session-status").getByText("일시정지").count(), 1);
  await kp2.getByRole("button", { name: "이어하기" }).click();
  await pl.getByTestId("session-status").getByText("진행 중").waitFor();
  step("GM이 직접 멈추면 정지 중에도 토큰 편집은 되고 굴림은 막히며, 새로고침해도 자동 재개되지 않고 이어하기로 풀림");

  // 새로고침(유예 안의 재접속): PL은 정지를 보지 않는다
  await kp2.reload();
  await kp2.getByTestId("connection").getByText("연결됨").waitFor();
  await kp2.waitForTimeout(500);
  assert.equal(await pl.getByText("세션이 일시정지 중이에요").count(), 0);
  assert.equal(await pl.getByTestId("session-status").getByText("진행 중").count(), 1);
  step("GM이 새로고침해도 유예 안에 돌아오면 PL 화면은 정지되지 않음");

  // 판정 효과: GM이 "어려운 성공"까지 켜면 PL 화면에 효과가 재생되고, PL이 개인 설정으로 끌 수 있음
  await openSettings(kp2);
  await kp2.getByRole("button", { name: "판정 효과" }).click();
  const hardBox = kp2.getByLabel("어려운 성공", { exact: true });
  await hardBox.click(); // 서버가 확정해야 체크되는 입력이라 check() 대신 click 후 확인한다
  await kp2.waitForFunction(() => [...document.querySelectorAll("label")].find((l) => l.textContent?.trim() === "어려운 성공")?.querySelector("input")?.checked === true);
  await kp2.keyboard.press("Escape");
  const rollOnce = async () => {
    await pl.getByLabel("굴림 식").fill("CC<=50");
    await pl.getByRole("button", { name: "굴리기" }).click();
    await pl.waitForTimeout(280);
  };
  let level = null;
  for (let i = 0; i < 80 && !level; i++) {
    await rollOnce();
    if (await pl.getByTestId("roll-effect").count()) level = await pl.getByTestId("roll-effect").getAttribute("data-level");
  }
  assert.ok(["critical", "extreme", "hard", "fumble"].includes(level), `효과가 재생되지 않음: ${level}`);
  step(`판정 효과가 PL 화면에 재생됨 (${level})`);

  await openSettings(pl);
  await pl.getByRole("button", { name: /^내 화면 효과 끄기/ }).click();
  await pl.keyboard.press("Escape");
  await pl.getByTestId("roll-effect").waitFor({ state: "detached", timeout: 4000 }).catch(() => {});
  for (let i = 0; i < 25; i++) {
    await rollOnce();
    assert.equal(await pl.getByTestId("roll-effect").count(), 0, "끈 뒤에도 효과가 재생됨");
  }
  step("PL이 효과를 끄면 더는 재생되지 않음");

  // 장면: GM이 다른 장면을 미리 꾸미면 PL에게는 안 보이고, 페이드 전환하면 PL 화면이 통째로 바뀜
  await addScene(kp2, "서재");
  await kp2.getByRole("tab", { name: "서재" }).click();
  await kp2.getByRole("button", { name: "+ 소품" }).click();
  await kp2.getByTestId("obj-소품1").waitFor();
  await pl.waitForTimeout(400);
  assert.equal(await pl.getByTestId("obj-소품1").count(), 0);
  step("GM이 준비 중인 다른 장면의 오브젝트는 PL에게 보이지 않음");

  await kp2.getByRole("button", { name: "페이드 전환" }).click();
  await pl.getByTestId("scene-name").getByText("서재").waitFor();
  await pl.getByTestId("obj-소품1").waitFor();
  assert.equal(await pl.getByTestId("obj-서하").count(), 0);
  step("페이드 전환하면 PL 화면이 새 장면으로 통째로 바뀜");

  // 파티 토큰: 체크를 끄면 PL 토큰을 새 장면으로 가져가지 않고, 켜 두면(기본) 가져간다
  const plObjs = pl.locator('[data-testid^="obj-"]');
  await kp2.getByRole("tab", { name: "장면 1" }).click(); // 활성 장면에서는 체크가 안 보여 다른 장면 탭을 연다
  assert.equal(await kp2.getByTestId("bring-party").isChecked(), true, "기본은 켜짐");
  for (const [scene, bring] of [["복도", false], ["회랑", true]]) {
    await addScene(kp2, scene);
    await kp2.getByRole("tab", { name: scene }).click();
    if (!bring) await kp2.getByTestId("bring-party").uncheck();
    await kp2.getByRole("button", { name: "바로 전환" }).click();
    await pl.getByTestId("scene-name").getByText(scene).waitFor();
    await pl.waitForTimeout(400);
    if (bring) assert.ok((await plObjs.count()) >= 1, "켜 두면 PL 토큰이 따라옴");
    else assert.equal(await plObjs.count(), 0, "끄면 PL 토큰이 따라오지 않음");
    if (!bring) {
      // 활성 장면에서는 체크가 안 보이므로, 다른 장면 탭에서 다시 켠다
      await kp2.getByRole("tab", { name: "서재" }).click();
      await kp2.getByTestId("bring-party").check();
    }
  }
  await kp2.getByRole("tab", { name: "서재" }).click();
  await kp2.getByRole("button", { name: "바로 전환" }).click();
  await pl.getByTestId("scene-name").getByText("서재").waitFor();
  step("PL 토큰도 가져가기: 끄면 새 장면이 비고, 켜면 PL 토큰이 따라옴");

  // 연출: Ctrl+K 명령어 검색으로 장면을 바꾸고, 슬롯에 등록한 동작을 숫자 키로 실행
  await kp2.keyboard.press("Control+k");
  await kp2.getByLabel("명령어 검색어").fill("장면 1 바로");
  await kp2.keyboard.press("Enter");
  await pl.getByTestId("scene-name").getByText("장면 1").waitFor();
  assert.equal(await kp2.getByRole("dialog", { name: "명령어 검색" }).count(), 0);
  step("Ctrl+K 검색으로 장면을 바꾸면 PL 화면이 전환됨");

  await dockTab(kp2, "cues");
  await kp2.getByRole("button", { name: "슬롯 1: 비어 있음" }).click();
  await kp2.getByLabel("명령어 검색어").fill("서재 페이드");
  await kp2.keyboard.press("Enter");
  await kp2.getByRole("button", { name: /^슬롯 1: 장면 전환 · 서재/ }).waitFor();
  await kp2.locator(".board").click({ position: { x: 20, y: 400 } });
  // 진행 중에 숫자 키로 장면을 바꾸면 3초 동안 한 줄로 알리고, 그 안에 취소할 수 있다
  await kp2.keyboard.press("1");
  const slotToast = kp2.getByTestId("toast").filter({ hasText: "장면 전환: 서재" });
  await slotToast.waitFor();
  await slotToast.getByTestId("toast-action").click(); // 취소
  await pl.waitForTimeout(3600);
  assert.equal(await pl.getByTestId("scene-name").getByText("서재").count(), 0, "취소하면 장면이 바뀌지 않아요");
  await kp2.keyboard.press("1");
  await pl.getByTestId("scene-name").getByText("서재").waitFor();
  step("슬롯 1의 장면 전환은 숫자 키 1을 누르면 3초 알림 뒤 실행되고, 그 안에 취소할 수 있음");
  await dockTab(kp2, "place");

  // 전투 순서: GM이 시작하고 NPC를 넣고 넘기면 PL 화면에 같은 순서와 차례가 보임
  // 활성 장면(서재)에 서하 소유 토큰을 놓아 둔다: 차례 링과 이동 안내를 보려는 것
  await kp2.getByLabel("새 토큰 소유자").selectOption({ label: "서하" });
  await kp2.getByLabel("새 토큰 이름").fill("전투서하");
  await kp2.getByRole("button", { name: "+ 토큰" }).click();
  await pl.getByTestId("obj-전투서하").waitFor();
  await kp2.getByRole("tab", { name: /^전투/ }).click();
  await kp2.getByRole("button", { name: "전투 시작" }).click();
  await pl.getByTestId("my-turn").waitFor();
  await pl.getByTestId("turn-ring").first().waitFor(); // 캐릭터 이름과 같은 토큰이 있으면 그 토큰에, 없으면 PL의 토큰에 링이 붙는다
  await pl.screenshot({ path: `${SHOTS}/turn-ring-pl.png` }); // 전투 탭을 안 봐도 내 차례면 보드 위에 표시
  await pl.getByRole("tab", { name: /^전투/ }).click();
  await pl.getByTestId("initiative-entry").filter({ hasText: CHAR }).waitFor();
  await kp2.getByLabel("NPC 이름").fill("광신도");
  await kp2.getByLabel("NPC DEX").fill("200");
  await kp2.getByTestId("initiative").getByRole("button", { name: "추가", exact: true }).click();
  await pl.getByTestId("initiative-entry").first().getByText("광신도").waitFor();
  // 지금 차례였던 캐릭터가 그대로 차례를 유지한다(NPC가 앞에 끼어도)
  await pl.getByTestId("initiative-entry").filter({ hasText: CHAR }).and(pl.locator("[aria-current=step]")).waitFor();
  await kp2.getByRole("button", { name: "다음 차례" }).click();
  await pl.getByTestId("initiative-round").getByText("2라운드").waitFor();
  await pl.getByTestId("initiative-entry").first().and(pl.locator("[aria-current=step]")).waitFor();
  assert.equal(await pl.getByRole("button", { name: "다음 차례" }).count(), 0);
  step("전투 순서: DEX 순으로 서고 NPC를 끼워 넣고 차례를 넘기면 PL 화면에 같은 순서가 보임");

  // 차례가 아니면 링이 사라지고, 끌면 서버는 허용하되 한 줄 안내가 뜬다. 끄는 동안 거리가 보인다.
  await pl.getByTestId("turn-ring").waitFor({ state: "detached" });
  {
    const b = await pl.getByTestId("obj-전투서하").locator("circle").first().boundingBox();
    await pl.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await pl.mouse.down();
    await pl.mouse.move(b.x + b.width / 2 + 90, b.y + b.height / 2, { steps: 6 });
    await pl.getByTestId("move-dist").waitFor();
    assert.match(await pl.getByTestId("move-dist").textContent(), /\d+\.\d칸/);
    await pl.screenshot({ path: `${SHOTS}/move-dist-pl.png` });
    await pl.mouse.up();
    await pl.getByTestId("toast").getByText("지금은 광신도의 차례예요").waitFor();
    await pl.getByTestId("move-dist").waitFor({ state: "detached" });
  }
  step("차례가 아닌 PL이 끌면 '지금은 광신도의 차례예요' 안내와 이동 거리가 뜨고 링은 차례 토큰에만 있음");

  // 이동 잠금/풀기: PL 토큰을 한 번에 잠그고 푼다
  await kp2.getByTestId("lock-all").click();
  await pl.getByTestId("obj-전투서하").and(pl.locator('[data-locked="true"]')).waitFor();
  await kp2.getByRole("button", { name: "이동 풀기" }).click();
  await pl.getByTestId("obj-전투서하").and(pl.locator(":not([data-locked])")).waitFor();
  step("GM의 '이동 잠금/이동 풀기'로 PL 토큰이 한꺼번에 잠기고 풀림");

  // 비밀: GM이 만든 NPC 시트의 이름·DEX는 전투 순서에서 PL에게 가려지고, 세션 정산에도 PL에게는 안 보임
  const SECRET_NPC = "비밀교단원 " + run;
  {
    const fs = await import("node:fs/promises");
    await sheetTabOnly(kp2);
    const [tpl] = await Promise.all([kp2.waitForEvent("download"), kp2.getByRole("button", { name: "양식 받기" }).click()]);
    const raw = (await fs.readFile(await tpl.path())).toString("utf8");
    await kp2.getByRole("button", { name: "CSV로 가져오기" }).click();
    await kp2.getByLabel("CSV 붙여넣기").fill(raw.replace("이름,\r\n", `이름,${SECRET_NPC}\r\n`));
    await kp2.getByTestId("csv-apply").click();
    await sheetTab(kp2, SECRET_NPC);
    await kp2.getByRole("tab", { name: /^전투/ }).click();
    await kp2.getByRole("button", { name: "전투 종료" }).click();
    await confirmAsk(kp2);
    await kp2.getByRole("button", { name: "전투 시작" }).click();
    await kp2.getByTestId("initiative-entry").filter({ hasText: SECRET_NPC }).waitFor();
    await pl.getByRole("tab", { name: /^전투/ }).click();
    await pl.getByTestId("initiative-entry").filter({ hasText: "알 수 없는 상대" }).waitFor();
    assert.equal(await pl.getByTestId("initiative").getByText(SECRET_NPC).count(), 0, "NPC 시트 이름이 PL에게 보이면 안 돼요");
    assert.equal(await pl.getByTestId("initiative-entry").filter({ hasText: "알 수 없는 상대" }).getByText(/DEX \?/).count(), 1);
    assert.equal(await pl.getByTestId("initiative-entry").filter({ hasText: CHAR }).count(), 1);
    await kp2.getByRole("button", { name: "전투 종료" }).click();
    await kp2.getByTestId("ask-dialog").getByRole("button", { name: "취소" }).click(); // 취소하면 전투가 그대로
    await kp2.getByTestId("initiative-entry").first().waitFor();
    await kp2.getByRole("button", { name: "전투 종료" }).click();
    await confirmAsk(kp2);
    await kp2.getByRole("button", { name: "전투 시작" }).waitFor();
    await closeSheet(kp2); await kp2.getByRole("tab", { name: "굴림" }).click();
    await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
  }
  step("전투 순서: GM 전용 NPC 시트는 PL에게 '알 수 없는 상대'로만 보이고(이름·DEX 숨김), GM에게는 그대로 보임");
  await closeSheet(kp2); await kp2.getByRole("tab", { name: "굴림" }).click();
  await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();

  // 피해 적용과 부상 규칙(7판): 중상 → 빈사 → 응급처치/회복, 상태 칩은 시트와 전투 순서에 같이 보임
  {
    const hpOf = (page) => page.getByTestId("stat-hp");
    await sheetTab(kp2);
    await sheetTab(kp2, CHAR);
    await sheetTab(pl);
    await hpOf(kp2).getByText("9/10").waitFor();
    await hpOf(pl).getByText("9/10").waitFor();
    assert.equal(await pl.getByTestId("gm-vitals").count(), 0, "PL 시트에는 피해·회복 입력이 없어요");
    await pl.getByTestId("sheet-status").getByText("부상").waitFor(); // HP가 최대보다 낮으면 부상
    // 1) 한 번에 6: 최대 HP 10의 절반(5) 이상이라 중상
    await kp2.getByLabel("적용할 피해").fill("6");
    await kp2.getByTestId("sheet-apply-damage").click();
    await hpOf(pl).getByText("3/10").waitFor();
    await hpOf(kp2).getByText("3/10").waitFor();
    await pl.getByTestId("sheet-status").getByTestId("status-chips").getByText("중상").waitFor();
    await pl.getByTestId("wound-hint").getByText(/중상이에요/).waitFor();
    assert.match(await pl.getByTestId("wound-threshold").innerText(), /한 번에 5 이상 피해/);
    await pl.getByTestId("toast").getByText(/중상이에요. 건강 판정\(CON\)을 해요/).waitFor();
    // 건강 판정(CON) 빠른 굴림: 배너와 시트 버튼 모두 CON으로 굴린다
    await pl.getByTestId("con-banner").waitFor();
    await pl.getByTestId("con-banner-roll").click();
    await pl.getByTestId("con-banner").waitFor({ state: "detached" });
    await pl.getByTestId("toast").getByText(new RegExp(`${CHAR} · CON · \\d+`)).waitFor();
    await pl.getByTestId("con-roll").waitFor();
    // 2) 방어구가 피해 이상이면 아무 일도 없다
    await kp2.getByLabel("적용할 피해").fill("4");
    await kp2.getByLabel("방어구", { exact: true }).fill("4");
    await kp2.getByTestId("sheet-apply-damage").click();
    await kp2.getByTestId("toast").getByText(/피해를 받지 않았어요/).waitFor();
    await hpOf(kp2).getByText("3/10").waitFor();
    await kp2.getByLabel("방어구", { exact: true }).fill("0");
    // 3) 전투 순서에도 같은 상태 칩이 붙는다
    await kp2.getByRole("tab", { name: /^전투/ }).click();
    await kp2.getByRole("button", { name: "전투 시작" }).click();
    await pl.getByRole("tab", { name: /^전투/ }).click();
    await kp2.getByTestId("initiative-entry").filter({ hasText: CHAR }).getByTestId("initiative-status").getByText("중상").waitFor();
    await pl.getByTestId("initiative-entry").filter({ hasText: CHAR }).getByTestId("initiative-status").getByText("중상").waitFor();
    // 4) HP가 0이 되면 중상 상태라 빈사
    await sheetTab(kp2);
    await kp2.getByLabel("적용할 피해").fill("3");
    await kp2.getByTestId("sheet-apply-damage").click();
    await hpOf(kp2).getByText("0/10").waitFor();
    await sheetTab(pl);
    await pl.getByTestId("sheet-status").getByTestId("status-chips").getByText("빈사").waitFor();
    await pl.getByTestId("wound-hint").getByText(/빈사 상태예요/).waitFor();
    await pl.getByRole("tab", { name: /^전투/ }).click();
    await pl.getByTestId("initiative-entry").filter({ hasText: CHAR }).getByTestId("initiative-status").getByText("빈사").waitFor();
    // 5) 한 바퀴 돌아 라운드가 오르면 빈사 라운드 세기가 오른다
    await kp2.getByRole("tab", { name: /^전투/ }).click();
    const turns = await kp2.getByTestId("initiative-entry").count();
    for (let i = 0; i < turns; i++) await kp2.getByRole("button", { name: "다음 차례" }).click();
    await kp2.getByTestId("initiative-round").getByText("2라운드").waitFor();
    await sheetTab(pl);
    await pl.getByTestId("wound-hint").getByText(/1라운드째/).waitFor();
    // 6) 응급처치: HP 1, 빈사는 풀리고 중상은 남는다
    await sheetTab(kp2);
    await kp2.getByTestId("heal-firstaid").click();
    await hpOf(pl).getByText("1/10").waitFor();
    await pl.getByTestId("sheet-status").getByTestId("status-chips").getByText("중상").waitFor();
    assert.equal(await pl.getByTestId("sheet-status").getByText("빈사").count(), 0);
    // 7) HP가 최대의 절반(5) 이상이 되면 중상이 풀린다 (남은 표시는 부상뿐)
    await kp2.getByLabel("회복량").fill("3");
    await kp2.getByTestId("heal-manual").click();
    await hpOf(pl).getByText("4/10").waitFor();
    await pl.getByTestId("sheet-status").getByTestId("status-chips").getByText("중상").waitFor();
    await kp2.getByTestId("heal-natural").click();
    await hpOf(pl).getByText("5/10").waitFor();
    await pl.getByTestId("sheet-status").getByTestId("status-chips").getByText("부상").waitFor();
    assert.equal(await pl.getByTestId("sheet-status").getByText("중상").count(), 0);
    step("피해 적용: 중상 기준·건강 판정(CON) 안내·방어구·빈사/응급처치/회복으로 상태 칩이 시트와 전투 순서에 바뀌고, PL 화면엔 GM 전용 입력이 없음");

    // 8) 피해 굴림 결과를 굴림 기록에서 대상 시트에 적용 (같은 피해는 같은 캐릭터에게 한 번만)
    await kp2.getByRole("button", { name: "주먹 피해" }).click();
    await closeSheet(kp2); await kp2.getByRole("tab", { name: "굴림" }).click();
    const dmgEntry = kp2.getByTestId("roll-entry").first();
    await dmgEntry.getByTestId("damage-apply").waitFor();
    assert.equal(await pl.getByTestId("damage-apply").count(), 0, "PL에게는 피해 적용 버튼이 없어요");
    await dmgEntry.getByLabel("피해를 받을 캐릭터").selectOption({ label: SECRET_NPC });
    await dmgEntry.getByTestId("damage-apply-btn").click();
    await dmgEntry.getByTestId("damage-applied").getByText(SECRET_NPC).waitFor();
    await dmgEntry.getByLabel("피해를 받을 캐릭터").selectOption({ label: `${SECRET_NPC} (적용됨)` });
    assert.equal(await dmgEntry.getByTestId("damage-apply-btn").isDisabled(), true, "같은 피해를 두 번 적용할 수 없어요");
    step("피해 굴림 결과를 굴림 기록의 '피해 적용'으로 대상 시트에 넣고, 같은 대상에게는 다시 못 넣음");

    // 9) 정리: HP를 9로 되돌리고(잘못 누른 값을 고치는 직접 입력도 상태를 맞춘다) 전투를 끝낸다
    await sheetTab(kp2);
    const gbox = kp2.getByLabel("HP 직접 입력");
    await gbox.fill("9");
    await gbox.press("Enter");
    await hpOf(pl).getByText("9/10").waitFor();
    await kp2.getByRole("tab", { name: /^전투/ }).click();
    await kp2.getByRole("button", { name: "전투 종료" }).click();
    await confirmAsk(kp2);
    await kp2.getByRole("button", { name: "전투 시작" }).waitFor();
    await closeSheet(kp2); await kp2.getByRole("tab", { name: "굴림" }).click();
    await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
  }

  // 대항 판정: GM이 NPC 시트와 PL 시트를 맞붙이면 두 굴림이 로그 한 항목으로 남는다
  {
    await closeSheet(kp2); await kp2.getByRole("tab", { name: "굴림" }).click();
    const form = kp2.getByTestId("opposed-form");
    await form.getByRole("button", { name: "대항 판정" }).click();
    await form.getByLabel("주도하는 캐릭터").selectOption({ label: SECRET_NPC });
    await form.getByLabel("주도하는 기능").selectOption("관찰력");
    await form.getByLabel("맞서는 캐릭터").selectOption({ label: CHAR });
    await form.getByLabel("맞서는 기능").selectOption("관찰력");
    const before = await kp2.getByTestId("roll-entry").count();
    await form.getByTestId("opposed-submit").click();
    for (const page of [kp2, pl]) {
      const e = page.getByTestId("roll-entry").first();
      await e.getByTestId("opposed-result").waitFor();
      assert.equal(await e.getByTestId("opposed-side").count(), 2);
      assert.match(await e.getByTestId("opposed-summary").innerText(), /이겼어요|둘 다 실패했어요|비겼어요/);
      assert.match(await e.innerText(), new RegExp(`${SECRET_NPC} · 관찰력 대 ${CHAR} · 관찰력|${CHAR}`));
    }
    assert.equal(await kp2.getByTestId("roll-entry").count(), before + 1, "대항 판정은 한 항목만 남겨요");
    // 대항 판정에는 푸시·행운 버튼이 없다
    assert.equal(await kp2.getByTestId("roll-entry").first().getByRole("button", { name: /푸시|행운/ }).count(), 0);
    await form.getByRole("button", { name: "대항 판정" }).click();
  }
  step("대항 판정: GM이 NPC 시트와 PL 시트를 맞붙이면 두 굴림과 결과 문장이 한 항목으로 모두에게 보이고 푸시·행운은 없음");

  // 그룹 판정: 판정 요청에서 '한꺼번에 굴리기'를 켜면 PL들의 캐릭터가 같은 기능으로 굴러 한 항목으로 요약됨
  {
    await openAsk(kp2);
    await kp2.getByLabel("요청할 기능").fill("관찰력");
    await kp2.getByLabel("그룹 판정").check();
    await kp2.getByTestId("ask-send").click();
    for (const page of [kp2, pl]) {
      const e = page.getByTestId("roll-entry").first();
      await e.getByTestId("group-result").waitFor();
      assert.ok((await e.getByTestId("group-entry").count()) >= 1);
      assert.match(await e.getByTestId("group-summary").innerText(), /성공했어요/);
      assert.ok((await e.innerText()).includes(CHAR));
      assert.ok(!(await e.innerText()).includes(SECRET_NPC), "그룹 판정에는 NPC 시트가 들어가지 않아요");
    }
  }
  step("그룹 판정: GM의 '그룹 판정' 요청이 PL 캐릭터들의 굴림을 한 항목으로 묶어 요약함 (NPC 시트는 제외)");

  // 세션 흐름: 비트와 분기를 짜 두면 조건이 맞을 때 GM에게만 제안하고, 엔딩을 확정하면 종료 창이 채워짐
  await kp2.getByRole("tab", { name: /^흐름/ }).click();
  assert.equal(await pl.getByRole("tab", { name: /^흐름/ }).count(), 0);
  await kp2.getByRole("button", { name: "비트 추가" }).click();
  await kp2.getByLabel("비트 이름").fill("단서 발견");
  await kp2.getByLabel("GM 메모").fill("비밀 메모 " + run);
  await kp2.getByRole("button", { name: "저장", exact: true }).click();
  await kp2.getByRole("button", { name: "비트 추가" }).click();
  await kp2.getByLabel("비트 이름").fill("새벽의 생존자");
  await kp2.getByLabel("비트 종류").selectOption({ label: "엔딩 비트" });
  await kp2.getByLabel("엔딩 SAN 보상").fill("1d4");
  await kp2.getByRole("button", { name: "저장", exact: true }).click();
  const clue = kp2.getByTestId("beat-item").filter({ hasText: "단서 발견" });
  await clue.getByRole("button", { name: "분기 추가" }).click();
  await kp2.getByLabel("분기 이름").fill("광기에 삼켜진다");
  await kp2.getByLabel("이동할 비트").selectOption({ label: "새벽의 생존자" });
  await kp2.getByLabel("분기 조건").selectOption({ label: "수치 임계" });
  await kp2.getByLabel("조건 기준값").fill("999");
  await kp2.getByRole("button", { name: "저장", exact: true }).click();
  await clue.getByRole("button", { name: "여기로 이동" }).click();
  await kp2.getByTestId("flow-current").getByText("비밀 메모 " + run).waitFor();
  await kp2.getByTestId("flow-suggestion").getByText(/제안: 광기에 삼켜진다/).waitFor();
  assert.equal(await pl.getByText("비밀 메모 " + run).count(), 0);
  await kp2.getByTestId("flow-suggestion").getByRole("button", { name: "엔딩 확정" }).click();
  await kp2.getByTestId("beat-item").filter({ hasText: "▶ 새벽의 생존자" }).waitFor();
  await kp2.getByRole("button", { name: "세션 종료" }).click();
  assert.equal(await kp2.getByLabel("엔딩 이름 (선택)").inputValue(), "새벽의 생존자");
  await kp2.keyboard.press("Escape");
  step("세션 흐름: 비트·분기를 짜면 조건이 맞을 때 GM에게만 제안하고, 엔딩 확정 뒤 종료 창이 엔딩 이름으로 채워짐");
  await closeSheet(kp2); await kp2.getByRole("tab", { name: "굴림" }).click();

  // 세션 종료 → 보관함에 반영
  await kp2.getByRole("button", { name: "세션 종료" }).click();
  await kp2.getByLabel("엔딩 이름 (선택)").fill("새벽의 생존자");
  await kp2.getByRole("button", { name: "정산하고 종료" }).click();
  await pl.getByTestId("session-status").getByText("대기").waitFor();
  await pl.getByRole("dialog", { name: "세션 정산" }).getByText("엔딩 · 새벽의 생존자").waitFor();
  {
    const plSummary = await pl.getByRole("dialog", { name: "세션 정산" }).innerText();
    assert.ok(plSummary.includes(CHAR), "PL 시트의 정산은 보여야 해요");
    assert.ok(!plSummary.includes(SECRET_NPC), "NPC 시트가 PL의 정산에 보이면 안 돼요");
    const gmSummary = await kp2.getByRole("dialog", { name: "세션 정산" }).innerText();
    assert.ok(gmSummary.includes(SECRET_NPC), "GM의 정산에는 NPC 시트도 보여야 해요");
  }
  await pl.keyboard.press("Escape");
  assert.equal(await pl.getByRole("dialog", { name: "세션 정산" }).count(), 0);
  step("세션 종료 때 엔딩 이름이 모두에게 보이고 닫을 수 있음(NPC 시트의 SAN 보상은 GM에게만)");
  await sheetTab(pl);
  await pl.getByRole("button", { name: "보관함에 반영" }).click();
  await pl.getByText("보관함에 반영했어요").waitFor();
  const vault = await (
    await fetch(`${API}/characters`, { headers: { "x-dev-user": encodeURIComponent("서하"), "x-dev-name": encodeURIComponent("서하") } })
  ).json();
  assert.equal(vault.find((c) => c.name === CHAR).hp, 9);
  step("세션 종료 뒤 변경된 HP가 보관함 원본에 반영됨");

  // 시작 장면: 지정해 두면 다음 세션을 시작할 때 그 장면이 열린다
  const summary = kp2.getByRole("dialog", { name: "세션 정산" });
  if (await summary.count()) await summary.getByRole("button", { name: "닫기" }).click();
  await kp2.getByRole("tab", { name: "장면 1" }).click();
  await openSceneMenu(kp2);
  await kp2.getByRole("button", { name: "시작 장면으로" }).click();
  await kp2.getByLabel("시작 장면").waitFor();
  assert.equal(await pl.getByLabel("시작 장면").count(), 0);
  await pl.getByTestId("scene-name").getByText("서재").waitFor();
  await kp2.getByRole("button", { name: "세션 시작" }).click();
  await pl.getByTestId("scene-name").getByText("장면 1").waitFor();
  step("시작 장면을 지정하면 세션을 시작할 때 그 장면이 열림(PL은 지정 표시를 못 봄)");

  // 이전 실행이 남긴 서재를 비워 개수 한도에 걸리지 않게 한다
  {
    const h = { "content-type": "application/json", "x-dev-user": encodeURIComponent("서하"), "x-dev-name": encodeURIComponent("서하") };
    const cur = await (await fetch(`${API}/library`, { headers: h })).json();
    await fetch(`${API}/library`, { method: "PUT", headers: h, body: JSON.stringify({ macros: [], occupations: cur.occupations, baseRevision: cur.revision }) });
  }

  // 매크로: 이름 붙여 저장한 식을 한 번에 굴리고, 잘못된 식은 거절하며, 다시 열어도 남아 있다
  await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
  await pl.getByRole("button", { name: "매크로 편집" }).click();
  await pl.getByLabel("매크로 이름").fill("한 방 " + run);
  await pl.getByLabel("매크로 굴림 식").fill("ㅁㅁㅁ");
  await pl.getByRole("button", { name: "저장", exact: true }).click();
  await pl.getByRole("alert").filter({ hasText: "알아볼 수 없어요" }).waitFor();
  await pl.getByLabel("매크로 굴림 식").fill("3d6");
  await pl.getByRole("button", { name: "저장", exact: true }).click();
  await pl.getByRole("button", { name: "닫기", exact: true }).click();
  const before = await pl.getByTestId("roll-entry").filter({ hasText: "3d6" }).count();
  await pl.getByTestId("macro").filter({ hasText: "한 방 " + run }).click();
  await pl.waitForFunction((n) => [...document.querySelectorAll('[data-testid="roll-entry"]')].filter((e) => e.textContent.includes("3d6")).length > n, before);
  await pl.reload();
  await pl.getByTestId("macro").filter({ hasText: "한 방 " + run }).waitFor();
  const serverLib = await (await fetch(`${API}/library`, { headers: { "x-dev-user": encodeURIComponent("서하"), "x-dev-name": encodeURIComponent("서하") } })).json();
  assert.ok(serverLib.macros.some((m) => m.name === "한 방 " + run && m.expr === "3d6"));
  step("매크로: 저장한 식을 한 번에 굴리고, 잘못된 식은 거절하며, 새로고침해도 남고 서버 서재에 저장됨");

  // 서재 충돌: 다른 기기가 먼저 저장해도 내 변경과 항목 단위로 합쳐지고 어느 쪽도 사라지지 않는다
  const dev = { "content-type": "application/json", "x-dev-user": encodeURIComponent("서하"), "x-dev-name": encodeURIComponent("서하") };
  const otherPut = await fetch(`${API}/library`, {
    method: "PUT",
    headers: dev,
    body: JSON.stringify({ macros: [...serverLib.macros, { id: "other" + run, name: "다른 기기 " + run, expr: "1d4", secret: false }], occupations: serverLib.occupations, baseRevision: serverLib.revision }),
  });
  assert.equal(otherPut.status, 200);
  await pl.getByRole("button", { name: "매크로 편집" }).click();
  await pl.getByLabel("매크로 이름").fill("이쪽 " + run);
  await pl.getByLabel("매크로 굴림 식").fill("1d8");
  await pl.getByRole("button", { name: "저장", exact: true }).click();
  await pl.getByRole("button", { name: "닫기", exact: true }).click();
  await pl.getByTestId("macro").filter({ hasText: "다른 기기 " + run }).waitFor();
  await pl.getByTestId("macro").filter({ hasText: "이쪽 " + run }).waitFor();
  const merged = await (await fetch(`${API}/library`, { headers: dev })).json();
  assert.ok(merged.macros.some((m) => m.name === "다른 기기 " + run) && merged.macros.some((m) => m.name === "이쪽 " + run));
  step("서재 충돌: 다른 기기가 먼저 저장해도 항목 단위로 합쳐져 둘 다 남음");

  // 굴림 기록 저장: 이 화면에서 보인 굴림이 마크다운 파일로 내려오고, 비밀 굴림 안내가 붙는다
  await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
  const [dl] = await Promise.all([pl.waitForEvent("download"), pl.getByRole("button", { name: "굴림 기록 저장" }).click()]);
  assert.match(dl.suggestedFilename(), /^roll-log-\d{8}\.md$/);
  const saved = await (await import("node:fs/promises")).readFile(await dl.path(), "utf8");
  assert.ok(saved.startsWith("# 굴림 기록"));
  assert.ok(saved.includes("볼 수 있었던 굴림만"));
  assert.ok(saved.includes("## 세션"));
  step("굴림 기록을 마크다운 파일로 저장함(PL에게는 비밀 굴림이 빠졌다는 안내가 붙음)");

  // 음향: GM이 올린 배경음이 모두에게 흐르고(DOM 상태만 확인), 비트 큐에 묶으면 비트에 들어갈 때 바뀜
  const wav = Buffer.alloc(44 + 4000);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + 4000, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(4000, 40);
  wav.fill(128, 44);
  assert.equal(await pl.getByRole("tab", { name: /^음향/ }).count(), 0);
  await kp2.getByRole("tab", { name: /^음향/ }).click();
  await kp2.getByLabel("음원 이름").fill("비 오는 밤 " + run);
  await kp2.getByLabel("음원 파일").setInputFiles({ name: "rain.wav", mimeType: "audio/wav", buffer: wav });
  const track = kp2.getByTestId("audio-track").filter({ hasText: "비 오는 밤 " + run });
  await track.waitFor();
  await track.getByRole("button", { name: "재생", exact: true }).click();
  await track.getByTestId("audio-playing").waitFor();
  await kp2.getByTestId("audio-now-name").getByText("비 오는 밤 " + run).waitFor();
  // 브라우저가 소리를 막으면(멈춘 오디오 컨텍스트) 헤더에 안내가 뜨고, 풀리면 사라진다
  {
    const muted = await (await ctx()).newPage();
    await muted.addInitScript(() => {
      class FakeCtx {
        state = "suspended";
        onstatechange = null;
        resume() {
          return new Promise((r) => {
            window.__unlock = () => { this.state = "running"; this.onstatechange?.(); r(); };
          });
        }
        decodeAudioData() { return Promise.reject(new Error("test")); }
        close() {}
      }
      window.AudioContext = FakeCtx;
    });
    await login(muted, "서하");
    await muted.goto(roomUrl);
    await muted.getByTestId("sound-blocked-hint").waitFor();
    await muted.getByTestId("board").click({ position: { x: 5, y: 5 } });
    await muted.getByTestId("sound-blocked-hint").waitFor();
    await muted.evaluate(() => window.__unlock());
    await muted.getByTestId("sound-blocked-hint").waitFor({ state: "detached" });
    await muted.context().close();
  }
  step("소리가 막히면 헤더에 안내가 뜨고, 풀리면 사라짐");
  await openSettings(pl);
  await pl.getByTestId("sound-toggle").click();
  await pl.getByLabel("전체 음소거").check();
  // 소리 설정 창이 열려 있는 동안 메뉴 목록은 가려지므로 글자만 확인한다.
  await pl.waitForFunction(() => document.querySelector('[data-testid="sound-toggle"]')?.textContent?.includes("소리 꺼짐"));
  await pl.getByLabel("전체 음소거").uncheck();
  await pl.keyboard.press("Escape");
  await kp2.getByRole("button", { name: "정지", exact: true }).click();
  await track.getByTestId("audio-playing").waitFor({ state: "detached" });
  step("음향: GM이 올린 배경음을 재생·정지하고, PL은 음향 탭 없이 내 소리 설정만 만짐");

  await kp2.getByRole("tab", { name: /^흐름/ }).click();
  await kp2.getByRole("button", { name: "비트 추가" }).click();
  await kp2.getByLabel("비트 이름").fill("빗소리 비트");
  await kp2.getByLabel("들어갈 때 틀 배경음").selectOption({ label: "비 오는 밤 " + run });
  await kp2.getByRole("button", { name: "저장", exact: true }).click();
  await kp2.getByTestId("beat-item").filter({ hasText: "빗소리 비트" }).getByRole("button", { name: "여기로 이동" }).click();
  await kp2.getByRole("tab", { name: /^음향/ }).click();
  await track.getByTestId("audio-playing").waitFor();
  // 장면 묶음: 장면에 배경음을 묶으면 장면을 바꿀 때 흐른다
  await kp2.getByRole("button", { name: "정지", exact: true }).click();
  await track.getByTestId("audio-playing").waitFor({ state: "detached" });
  await kp2.getByRole("tab", { name: "서재" }).click();
  await openSceneMenu(kp2);
  await kp2.getByLabel("장면 배경음").selectOption({ label: "♪ 비 오는 밤 " + run });
  await kp2.keyboard.press("Escape");
  await kp2.getByRole("button", { name: "바로 전환" }).click();
  await pl.getByTestId("scene-name").getByText("서재").waitFor();
  await kp2.getByRole("tab", { name: /^음향/ }).click();
  await track.getByTestId("audio-playing").waitFor();
  await track.getByRole("button", { name: /삭제$/ }).click();
  await confirmAsk(kp2);
  await track.waitFor({ state: "detached" });
  step("음향: 비트 큐에 묶은 배경음이 비트에 들어가면 흐르고, 음원을 지우면 목록에서 사라짐");

  // GM 전용 노트: PL에게 안 보이고, 펼쳐 보이기 버튼도 없다
  await closeSheet(kp2); await kp2.getByRole("tab", { name: "핸드아웃" }).click();
  await kp2.getByRole("button", { name: "새 핸드아웃" }).click();
  await kp2.getByLabel("핸드아웃 제목").fill("진상 " + run);
  await kp2.getByLabel("핸드아웃 내용").fill("범인은 이웃");
  await kp2.getByLabel("공개 범위").selectOption("note");
  await kp2.getByRole("button", { name: "저장", exact: true }).click();
  const note = kp2.getByTestId("handout-item").filter({ hasText: "진상 " + run });
  await note.getByText("GM 노트").waitFor();
  assert.equal(await note.getByRole("button", { name: "펼쳐 보이기" }).count(), 0);
  await closeSheet(pl); await pl.getByRole("tab", { name: "핸드아웃" }).click();
  await pl.waitForTimeout(400);
  assert.equal(await pl.getByText("진상 " + run).count(), 0);
  step("GM 전용 노트는 PL에게 보이지 않고 펼쳐 보일 수도 없음");

  // 토큰 소유자: PL 3명이 각자 자기 토큰만 움직이고, GM이 이름·소유자를 바꾼다
  {
    const SHOT = "/tmp/shots-token";
    const kpT = await (await ctx()).newPage();
    await login(kpT, "하늘" + run);
    await kpT.getByLabel("새 룸 이름").fill("토큰방 " + run);
    await kpT.getByRole("button", { name: "새 룸 만들기", exact: true }).click();
    await kpT.waitForURL(/\/room\//);
    await kpT.getByTestId("connection").getByText("연결됨").waitFor();
    await kpT.getByRole("button", { name: "초대", exact: true }).click();
    const inv = await kpT.getByLabel("초대 링크 주소").inputValue();
    await kpT.keyboard.press("Escape");
    const names = ["서하" + run, "도윤" + run, "이안" + run];
    const pls = [];
    for (const nm of names) {
      const p = await (await ctx()).newPage();
      await p.goto(inv);
      await p.getByLabel("이름").fill(nm);
      await p.getByRole("button", { name: "계속하기" }).click();
      await p.getByRole("button", { name: "PL로 입장" }).click();
      await p.getByTestId("connection").getByText("연결됨").waitFor();
      pls.push(p);
    }
    await pls[0].getByTestId("no-token-hint").waitFor();
    step("토큰이 없는 PL 화면에 안내 한 줄이 보임");
    await kpT.getByRole("button", { name: "세션 시작" }).click();
    await pls[2].getByTestId("session-status").getByText("진행 중").waitFor();

    await kpT.getByRole("button", { name: "PL 전원 토큰 만들기" }).click();
    for (const p of pls) for (const nm of names) await p.getByTestId(`obj-${nm}`).waitFor();
    // 겹치지 않고, 각자 화면에서 자기 토큰만 "내 토큰" 표시
    const pos = await kpT.evaluate((ns) => ns.map((n) => { const e = document.querySelector(`[data-testid="obj-${n}"]`); return [Number(e.getAttribute("data-x")), Number(e.getAttribute("data-y"))]; }), names);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]) >= 56, "토큰이 겹침");
    for (let i = 0; i < 3; i++) {
      assert.equal(await pls[i].getByTestId(`obj-${names[i]}`).getAttribute("data-mine"), "true");
      assert.equal(await pls[i].locator('[data-mine="true"]').count(), 1);
      assert.equal(await pls[i].getByTestId("no-token-hint").count(), 0);
    }
    step("PL 전원 토큰 만들기: 이름대로 3개가 겹치지 않게 놓이고 각자 자기 토큰만 '나'로 표시됨");

    // ── 대화·귓속말·세션 기록 ──
    {
      const chatTab = (p) => p.getByRole("tab", { name: /^대화/ });
      const openChat = async (p) => { await chatTab(p).click(); await p.getByTestId("chat-input").waitFor(); };
      const msgs = (p) => p.getByTestId("chat-list").getByTestId("chat-msg");
      // 서버는 한 사람이 초당 3번까지만 받으므로 같은 사람의 연속 전송은 간격을 둔다.
      const lastSay = new WeakMap();
      const say = async (p, text) => {
        const wait = 450 - (Date.now() - (lastSay.get(p) ?? 0));
        if (wait > 0) await p.waitForTimeout(wait);
        await p.getByTestId("chat-input").fill(text);
        await p.getByTestId("chat-input").press("Enter");
        lastSay.set(p, Date.now());
      };
      const readDownload = async (p, testid) => {
        const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId(testid).click()]);
        return (await import("node:fs/promises")).readFile(await dl.path(), "utf8");
      };

      // PL이 말하면 GM 화면 대화 탭에 안 읽은 표시가 뜨고, 열면 메시지가 보임
      await openChat(pls[0]);
      await say(pls[0], "안녕하세요 GM님");
      await kpT.getByTestId("chat-unread").waitFor();
      assert.equal((await kpT.getByTestId("chat-unread").innerText()).trim(), "1");
      await openChat(kpT);
      await kpT.getByTestId("chat-list").getByText("안녕하세요 GM님").waitFor();
      assert.equal(await kpT.getByTestId("chat-unread").count(), 0);
      await openChat(pls[1]);
      await openChat(pls[2]);
      await pls[1].getByTestId("chat-list").getByText("안녕하세요 GM님").waitFor();
      step("대화: PL이 보낸 말이 GM에게 보이고 안 읽은 표시는 열면 사라짐");

      // Shift+Enter는 줄바꿈, 글자 조합 중 Enter는 보내지 않음
      const box = pls[0].getByTestId("chat-input");
      await box.fill("첫 줄");
      await box.press("Shift+Enter");
      await box.pressSequentially("둘째 줄");
      assert.equal(await box.inputValue(), "첫 줄\n둘째 줄");
      const before = await msgs(pls[0]).count();
      await box.evaluate((el) => el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
      await box.press("Enter");
      await pls[0].waitForTimeout(300);
      assert.equal(await msgs(pls[0]).count(), before, "조합 중 Enter로 보내면 안 돼요");
      await box.evaluate((el) => el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
      await box.press("Enter");
      lastSay.set(pls[0], Date.now());
      await pls[1].getByTestId("chat-list").getByText("둘째 줄").waitFor();
      step("대화: Shift+Enter는 줄바꿈, 글자 조합 중 Enter는 보내지 않음");

      // 슬래시 도움말, 모르는 명령은 오류
      await pls[0].getByTestId("chat-help-btn").click();
      await pls[0].getByTestId("chat-help").getByText(/\/w 이름 내용/).waitFor();
      await pls[0].getByTestId("chat-help-btn").click();
      await say(pls[0], "/zzz");
      await pls[0].getByTestId("chat-error").getByText(/알 수 없는 명령/).waitFor();
      await box.fill("");
      step("대화: ? 버튼으로 명령어 도움말, 모르는 명령은 오류 안내");

      // /r 은 대화와 굴림 기록에 함께 남고 모두에게 보임
      await say(pls[0], "/r 1d100");
      const rollMsg = pls[1].getByTestId("chat-list").locator('[data-kind="roll"]');
      await rollMsg.first().waitFor();
      assert.match(await rollMsg.first().innerText(), /1d100/);
      await pls[0].getByRole("tab", { name: "굴림" }).click();
      await pls[0].getByTestId("roll-log").getByTestId("roll-entry").filter({ hasText: "1d100" }).first().waitFor();
      await openChat(pls[0]);
      step("대화: /r 1d100 굴림이 대화와 굴림 기록에 함께 남고 다른 PL에게도 보임");

      // 귓속말: 기본은 PL→GM만. 다른 PL은 받는 사람 목록에도, 대화에도 없음
      const toOptions = async (p) => selOptions(p.getByTestId("chat-to"));
      const gmLabel = `하늘${run} (GM)`;
      assert.deepEqual(await toOptions(pls[0]), ["모두", gmLabel]);
      await pls[0].getByTestId("chat-to").selectOption({ label: gmLabel });
      await say(pls[0], "이건 둘만의 비밀");
      await kpT.getByTestId("chat-list").locator('[data-kind="whisper"]').filter({ hasText: "이건 둘만의 비밀" }).waitFor();
      await pls[0].getByTestId("chat-to").selectOption("");
      await say(pls[0], "공개 마무리 말");
      await pls[1].getByTestId("chat-list").getByText("공개 마무리 말").waitFor();
      await pls[2].getByTestId("chat-list").getByText("공개 마무리 말").waitFor();
      assert.equal(await pls[1].getByText("이건 둘만의 비밀").count(), 0);
      assert.equal(await pls[2].getByText("이건 둘만의 비밀").count(), 0);
      step("귓속말: GM에게만 보이고 다른 PL 화면에는 나타나지 않음");

      // /w 로도 보내고, PL끼리 귓속말은 GM이 허용해야 하며 그 귓속말은 GM도 못 봄
      await say(pls[0], `/w 도윤${run} 몰래`);
      await pls[0].getByTestId("chat-error").waitFor();
      await box.fill("");
      await kpT.getByTestId("chat-plwhisper").click(); // 서버가 받아들인 뒤에 체크가 켜진다
      await kpT.waitForFunction(() => document.querySelector('[data-testid="chat-plwhisper"]').checked);
      for (let t = 0; t < 50 && !(await toOptions(pls[0])).some((x) => x.includes(`도윤${run}`)); t++) await pls[0].waitForTimeout(200);
      await say(pls[0], `/w 도윤${run} 둘이서만`);
      await pls[1].getByTestId("chat-list").locator('[data-kind="whisper"]').filter({ hasText: "둘이서만" }).waitFor();
      await say(pls[0], "그리고 다시 공개");
      await kpT.getByTestId("chat-list").getByText("그리고 다시 공개").waitFor();
      await pls[2].getByTestId("chat-list").getByText("그리고 다시 공개").waitFor();
      assert.equal(await kpT.getByText("둘이서만").count(), 0, "PL끼리 귓속말을 GM이 보면 안 돼요");
      assert.equal(await pls[2].getByText("둘이서만").count(), 0);
      step("귓속말: /w로 보내고, PL끼리는 GM이 허용했을 때만 되며 GM과 제3자는 볼 수 없음");

      // 다시 접속해도 받은 귓속말 기록은 받은 사람에게만 남음
      await pls[2].reload();
      await pls[2].getByTestId("connection").getByText("연결됨").waitFor();
      await openChat(pls[2]);
      await pls[2].getByTestId("chat-list").getByText("그리고 다시 공개").waitFor();
      assert.equal(await pls[2].getByText("이건 둘만의 비밀").count(), 0);
      assert.equal(await pls[2].getByText("둘이서만").count(), 0);
      step("대화: 새로고침해도 지난 대화가 돌아오고 남의 귓속말은 나타나지 않음");

      // 세션 기록: GM은 전체, PL은 공개된 것만. 마크다운으로 내려받아 내용을 확인
      await kpT.getByTestId("chat-input").fill("/hr 1d100");
      await kpT.getByTestId("chat-input").press("Enter");
      await kpT.getByTestId("chat-list").locator('[data-kind="secret"]').waitFor();
      await closeSheet(kpT); await kpT.getByRole("tab", { name: "기록" }).click();
      await kpT.getByTestId("log-list").getByTestId("log-item").first().waitFor();
      const gmMd = await readDownload(kpT, "log-export-md");
      assert.match(gmMd, /GM용 기록/);
      assert.match(gmMd, /세션 \d+/);
      assert.match(gmMd, /\*\*굴림\*\*/);
      assert.match(gmMd, /1d100/);
      assert.match(gmMd, /안녕하세요 GM님/);
      assert.ok(!gmMd.includes("이건 둘만의 비밀"), "귓속말은 기록에 들어가면 안 돼요");
      assert.ok(!gmMd.includes("둘이서만"));
      await pls[1].getByRole("tab", { name: "기록" }).click();
      await pls[1].getByTestId("log-list").getByTestId("log-item").first().waitFor();
      const plMd = await readDownload(pls[1], "log-export-md");
      assert.match(plMd, /참가자에게 보이는 내용만/);
      assert.match(plMd, /안녕하세요 GM님/);
      assert.match(plMd, /1d100/);
      assert.ok(!plMd.includes("이건 둘만의 비밀") && !plMd.includes("둘이서만"));
      assert.ok(!plMd.includes("GM 전용"));
      const plJson = JSON.parse(await readDownload(pls[1], "log-export-json"));
      assert.equal(plJson.audience, "public");
      assert.ok(plJson.entries.every((x) => !x.scope), "PL 기록에 GM 전용 표시가 있으면 안 돼요");
      // GM이 참가자용으로 바꿔 보면 GM 전용 항목이 사라짐
      await kpT.getByTestId("log-as-public").check();
      await kpT.getByTestId("log-audience").getByText(/참가자에게 보이는 기록만/).waitFor();
      const asPlMd = await readDownload(kpT, "log-export-md");
      assert.match(asPlMd, /참가자에게 보이는 내용만/);
      // 종류 필터
      await kpT.getByTestId("log-as-public").uncheck();
      await kpT.getByTestId("log-kind-roll").click();
      await kpT.getByTestId("log-list").locator('[data-kind="chat"]').first().waitFor({ state: "detached" });
      assert.ok((await kpT.getByTestId("log-item").count()) > 0);
      assert.equal(await kpT.getByTestId("log-item").evaluateAll((els) => els.some((e) => e.getAttribute("data-kind") !== "roll")), false);
      await kpT.getByTestId("log-reset").click();
      for (const p of [kpT, ...pls]) { await closeSheet(p); await p.getByRole("tab", { name: "굴림" }).click(); }
      step("세션 기록: GM용·참가자용 마크다운/JSON 내보내기에 굴림·대화 발췌가 있고 귓속말·GM 전용은 참가자 버전에 없으며 종류 필터가 동작");
    }

    const dragBy = async (page, name, dx, dy) => {
      const b = await page.getByTestId(`obj-${name}`).locator("circle").first().boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 6 });
      await page.mouse.up();
    };
    const posOf = (page, name) => page.evaluate((n) => { const e = document.querySelector(`[data-testid="obj-${n}"]`); return [Number(e.getAttribute("data-x")), Number(e.getAttribute("data-y"))]; }, name);
    const before = await Promise.all(names.map((n) => posOf(kpT, n)));
    for (let i = 0; i < 3; i++) {
      await dragBy(pls[i], names[i], 90, 140);
      await kpT.waitForFunction(([n, x, y]) => { const e = document.querySelector(`[data-testid="obj-${n}"]`); return Math.hypot(Number(e.getAttribute("data-x")) - x, Number(e.getAttribute("data-y")) - y) > 40; }, [names[i], ...before[i]]);
    }
    // 남의 토큰은 안 움직임: 서하가 도윤 토큰을 끌어 본다
    const dBefore = await posOf(kpT, names[1]);
    await dragBy(pls[0], names[1], -100, -100);
    await pls[0].waitForTimeout(500);
    const dAfter = await posOf(kpT, names[1]);
    assert.deepEqual(dAfter, dBefore);
    step("PL 3명이 각자 자기 토큰만 움직이고 남의 토큰은 움직이지 않음");

    // GM이 이름·소유자를 바꾼다: 도윤 토큰을 NPC로 풀고 이름 변경 → 도윤은 못 움직임
    await kpT.getByTestId(`obj-${names[1]}`).click();
    await kpT.getByLabel("선택한 토큰·소품 이름").fill("문지기 " + run);
    await kpT.getByRole("button", { name: "이름 바꾸기" }).click();
    await pls[0].getByTestId(`obj-문지기 ${run}`).waitFor();
    await kpT.getByLabel("선택한 토큰 소유자").selectOption("");
    await pls[1].waitForFunction((n) => document.querySelector(`[data-testid="obj-${n}"]`)?.getAttribute("data-mine") === null, "문지기 " + run);
    const g0 = await posOf(kpT, "문지기 " + run);
    await dragBy(pls[1], "문지기 " + run, 80, 80);
    await pls[1].waitForTimeout(500);
    assert.deepEqual(await posOf(kpT, "문지기 " + run), g0);
    // 이안에게 넘기면 이안이 움직인다
    await kpT.getByLabel("선택한 토큰 소유자").selectOption({ label: names[2] });
    await pls[2].waitForFunction((n) => document.querySelector(`[data-testid="obj-${n}"]`)?.getAttribute("data-mine") === "true", "문지기 " + run);
    await dragBy(pls[2], "문지기 " + run, 80, 80);
    await kpT.waitForFunction(([n, x, y]) => { const e = document.querySelector(`[data-testid="obj-${n}"]`); return Math.hypot(Number(e.getAttribute("data-x")) - x, Number(e.getAttribute("data-y")) - y) > 40; }, ["문지기 " + run, ...g0]);
    // 잠그면 소유자도 못 움직임
    await kpT.getByRole("button", { name: "잠그기" }).click();
    await kpT.getByRole("button", { name: "잠김" }).waitFor();
    const g1 = await posOf(kpT, "문지기 " + run);
    await dragBy(pls[2], "문지기 " + run, -60, -60);
    await pls[2].waitForTimeout(500);
    assert.deepEqual(await posOf(kpT, "문지기 " + run), g1);
    step("GM이 토큰 이름을 바꾸고 소유자를 NPC로 풀거나 다른 PL에게 넘기고, 잠그면 소유자도 못 움직임");

    // 시트→토큰: GM이 시트 패널에서 토큰으로 놓기
    await pls[0].getByRole("tab", { name: "시트" }).click();
    await pls[0].screenshot({ path: `${SHOT}/pl-board.png` });
    await kpT.screenshot({ path: `${SHOT}/kp-board.png` });
    await pls[2].screenshot({ path: `${SHOT}/pl3-board.png` });
  }

  // 보드: 방향키로 내 토큰을 움직이고, 확대·축소와 '전체'로 보기 영역을 바꾼다
  {
    const tok = pl.locator('[data-mine="true"]').first();
    await tok.waitFor();
    const tid = await tok.getAttribute("data-testid");
    await tok.click();
    const x0 = Number(await tok.getAttribute("data-x"));
    for (let i = 0; i < 3; i++) await pl.keyboard.press("ArrowRight"); // 한 번에 20
    await pl.waitForFunction(([t, x]) => Number(document.querySelector(`[data-testid="${t}"]`)?.getAttribute("data-x")) === x, [tid, x0 + 60]);
    await kp2.waitForFunction(([t, x]) => Number(document.querySelector(`[data-testid="${t}"]`)?.getAttribute("data-x")) === x, [tid, x0 + 60]);
    await pl.keyboard.press("Shift+ArrowRight"); // Shift는 5
    await pl.waitForFunction(([t, x]) => Number(document.querySelector(`[data-testid="${t}"]`)?.getAttribute("data-x")) === x, [tid, x0 + 65]);
    const vb = async (page) => (await page.getByTestId("board").getAttribute("viewBox")).split(" ").map(Number);
    assert.equal((await vb(pl))[2], 1000);
    await pl.getByRole("button", { name: "확대" }).click();
    assert.ok((await vb(pl))[2] < 1000);
    await pl.getByTestId("focus-mine").click();
    await pl.getByRole("button", { name: "맞춤" }).click();
    assert.equal((await vb(pl))[2], 1000);
    step("보드: 방향키로 내 토큰이 움직여 GM에게도 보이고(20, Shift 5), 확대·내 토큰 보기·맞춤이 동작함");
  }

  // 보드 보기·자·격자·단축키 도움말(데스크톱)
  {
    const zoomOf = async (page) => Number(await page.getByTestId("board").getAttribute("data-zoom"));
    const vbOf = async (page) => (await page.getByTestId("board").getAttribute("viewBox")).split(" ").map(Number);
    // 휠: 커서 자리를 기준으로 확대되고, 빈 곳을 끌면 보기가 옮겨지고, 맞춤으로 돌아온다
    const bx = await pl.getByTestId("board").boundingBox();
    assert.equal(await zoomOf(pl), 1);
    await pl.mouse.move(bx.x + bx.width * 0.75, bx.y + bx.height * 0.5);
    await pl.mouse.wheel(0, -500);
    await pl.waitForFunction(() => Number(document.querySelector('[data-testid="board"]').getAttribute("data-zoom")) > 1.4);
    const v1 = await vbOf(pl);
    assert.ok(v1[0] > 0, "커서가 오른쪽에 있으면 보기 왼쪽 끝이 오른쪽으로 옮겨져요");
    await pl.mouse.move(bx.x + bx.width * 0.5, bx.y + bx.height - 24);
    await pl.mouse.down();
    await pl.mouse.move(bx.x + bx.width * 0.5 + 120, bx.y + bx.height - 24, { steps: 6 });
    await pl.mouse.up();
    const v2 = await vbOf(pl);
    assert.ok(v2[0] < v1[0] - 20, `끌면 보기가 옮겨져요 ${v1[0]} → ${v2[0]}`);
    await pl.getByTestId("zoom-fit").click();
    assert.equal(await zoomOf(pl), 1);
    // 토큰 이름표는 접근 가능한 이름과 역할을 갖는다
    const mineLabel = await pl.locator('[data-mine="true"]').first().getAttribute("aria-label");
    assert.match(mineLabel, /내 토큰.*위치 \d+ \d+/);
    assert.equal(await pl.locator('[data-mine="true"]').first().getAttribute("role"), "img");
    step("보드 보기: 휠 확대(커서 기준)·빈 곳 끌어 이동·맞춤, 토큰에 이름·위치 설명이 붙음");

    // 자: 나에게만 보이고 저장하지 않는다
    const gbx = await kp2.getByTestId("board").boundingBox();
    await kp2.getByTestId("ruler-toggle").click();
    await kp2.mouse.move(gbx.x + 120, gbx.y + gbx.height - 90);
    await kp2.mouse.down();
    await kp2.mouse.move(gbx.x + 120 + 200, gbx.y + gbx.height - 90, { steps: 5 });
    await kp2.mouse.up();
    await kp2.getByTestId("ruler-label").waitFor();
    assert.match(await kp2.getByTestId("ruler-label").textContent(), /\d+(\.\d)?칸 \(\d+\)/);
    assert.equal(await pl.getByTestId("ruler").count(), 0, "자는 다른 사람 화면에 보이지 않아요");
    await kp2.getByTestId("ruler-toggle").click();
    assert.equal(await kp2.getByTestId("ruler").count(), 0);
    step("자: 끌어서 칸 수와 거리를 재고, 나에게만 보이며 끄면 사라짐");

    // 격자: GM이 장면 설정에서 크기·보이기·칸 맞춤을 정하면 PL 화면에도 격자가 그려지고 토큰이 칸 가운데로 맞춰진다
    await openSceneMenu(kp2);
    await kp2.getByTestId("grid-size").fill("50");
    await kp2.getByTestId("grid-size").press("Enter");
    await kp2.getByTestId("grid-show").click();
    await kp2.getByTestId("grid-show").evaluate((e) => new Promise((r) => { const t = setInterval(() => e.checked && (clearInterval(t), r()), 30); }));
    await kp2.getByTestId("grid-snap").click();
    await kp2.getByTestId("grid-snap").evaluate((e) => new Promise((r) => { const t = setInterval(() => e.checked && (clearInterval(t), r()), 30); }));
    await pl.getByTestId("board-grid").waitFor();
    await pl.getByTestId("snap-toggle").waitFor();
    assert.equal(await pl.getByTestId("snap-toggle").getAttribute("aria-pressed"), "true");
    await kp2.keyboard.press("Escape");
    {
      const ring = pl.locator('[data-mine="true"] [data-testid="mine-ring"]').first();
      const rb = await ring.boundingBox();
      const cx = rb.x + rb.width / 2;
      const cy = rb.y + rb.height / 2;
      const tid = await pl.locator('[data-mine="true"]').first().getAttribute("data-testid");
      await pl.mouse.move(cx, cy);
      await pl.mouse.down();
      await pl.mouse.move(cx + 93, cy + 57, { steps: 6 });
      await pl.mouse.up();
      await pl.waitForFunction((t) => {
        const g = document.querySelector(`[data-testid="${t}"]`);
        return g && Number(g.getAttribute("data-x")) % 50 === 25 && Number(g.getAttribute("data-y")) % 50 === 25;
      }, tid);
      // 맞춤을 내 화면에서 끄면 다시 자유롭게 놓인다
      await pl.getByTestId("snap-toggle").click();
      assert.equal(await pl.getByTestId("snap-toggle").getAttribute("aria-pressed"), "false");
    }
    // 되돌려 놓는다
    await openSceneMenu(kp2);
    await kp2.getByTestId("grid-show").click();
    await kp2.getByTestId("grid-show").evaluate((e) => new Promise((r) => { const t = setInterval(() => !e.checked && (clearInterval(t), r()), 30); }));
    await kp2.getByTestId("grid-snap").click();
    await kp2.getByTestId("grid-snap").evaluate((e) => new Promise((r) => { const t = setInterval(() => !e.checked && (clearInterval(t), r()), 30); }));
    await pl.getByTestId("board-grid").waitFor({ state: "detached" });
    await kp2.keyboard.press("Escape");
    step("격자: GM이 크기·보이기·칸 맞춤을 정하면 PL 화면에 격자가 그려지고 토큰이 칸 가운데에 맞춰지며, 내 화면에서 끌 수 있음");

    // 단축키 도움말: ? 키와 설정 메뉴로 열고 Esc로 닫는다. PL에게는 GM 전용 키가 없다
    await pl.getByTestId("board").focus();
    await pl.keyboard.press("?");
    const help = pl.getByTestId("shortcut-help");
    await help.waitFor();
    const helpText = await help.innerText();
    assert.ok(helpText.includes("방향키") && helpText.includes("Tab") && helpText.includes("Esc") && !helpText.includes("Delete"), helpText);
    await pl.keyboard.press("Escape");
    await help.waitFor({ state: "detached" });
    await openSettings(kp2);
    await kp2.getByTestId("open-shortcuts").click();
    const gmHelp = kp2.getByTestId("shortcut-help");
    await gmHelp.waitFor();
    const gmText = await gmHelp.innerText();
    for (const k of ["Delete", "Ctrl+Z", "Ctrl+D", "Esc", "Tab", "1 ~ 9", "Ctrl+K", "방향키"]) assert.ok(gmText.includes(k), `${k} 가 도움말에 있어야 해요`);
    await kp2.keyboard.press("Escape");
    await gmHelp.waitFor({ state: "detached" });
    step("단축키 도움말: ? 키·설정 메뉴로 열고 Esc로 닫으며, PL에게는 GM 전용 키를 보여 주지 않음");
  }

  // 룸 시트: CSV로 내보내기, 수정한 기능만 보기, 묶음 접기. GM은 CSV로 NPC를 룸에 등록한다
  {
    const fs = await import("node:fs/promises");
    await sheetTab(pl);
    const [dl] = await Promise.all([pl.waitForEvent("download"), pl.getByRole("button", { name: "CSV로 내보내기" }).click()]);
    const raw = await fs.readFile(await dl.path());
    const text = raw.toString("utf8");
    assert.ok(text.includes(CHAR) && text.includes("[파생 수치]") && text.includes("도서관 이용,60,"));
    assert.equal(await pl.getByRole("button", { name: "CSV로 가져오기" }).count(), 0, "이미 캐릭터가 있는 PL은 룸에서 가져올 수 없음");
    const sheet = pl.getByTestId("sheet");
    const all = await sheet.locator('[data-testid^="skill-"]').count();
    assert.ok(all > 30);
    await sheet.getByLabel("수정한 기능만 보기").check();
    const edited = await sheet.locator('[data-testid^="skill-"]').count();
    assert.ok(edited >= 1 && edited < all);
    await sheet.getByTestId("skill-도서관 이용").waitFor();
    await sheet.getByLabel("수정한 기능만 보기").uncheck();
    assert.equal(await sheet.locator('[data-testid^="skill-"]').count(), all);
    const toggle = sheet.getByTestId("sheet-skills").getByRole("button", { name: /^기능/ }).first();
    await toggle.click();
    assert.equal(await sheet.getByTestId("skill-도서관 이용").isVisible(), false);
    await toggle.click();
    await sheet.getByTestId("skill-도서관 이용").waitFor();

    const NPC = "CSV 조수 " + run;
    await sheetTabOnly(kp2);
    await kp2.getByRole("button", { name: "CSV로 가져오기" }).click();
    await kp2.getByLabel("CSV 붙여넣기").fill(text.replace(CHAR, NPC));
    await kp2.getByTestId("csv-preview").getByText(NPC).waitFor();
    await kp2.getByTestId("csv-apply").click();
    await sheetTab(kp2, NPC);
    assert.equal(await kp2.getByTestId("sheet-modal").getByRole("dialog").getAttribute("aria-label"), `시트 · ${NPC}`);
    await kp2.getByTestId("stat-hp").getByText("9/10").waitFor();
    assert.equal(await pl.getByTestId("sheet-card").filter({ hasText: NPC }).count(), 0, "PL은 GM이 등록한 NPC 시트를 받지 않음");
  }
  step("룸 시트: CSV 내보내기, 수정한 기능만 보기·묶음 접기가 동작하고, GM은 CSV로 시트를 룸에 등록함(PL은 이미 있으면 가져오기 버튼이 없음)");

  // 준비 도구 1: 토큰↔시트 연결(HP 막대·상태 칩, 눌러서 시트 열기), HP 공개, 시트 연결 고르기
  const NPC = "CSV 조수 " + run;
  const hpBar = (page, name) => page.getByTestId(`obj-${name}`).locator('[data-testid^="hp-"]');
  const tabOn = (page, name) => page.locator('[role="tab"][aria-selected="true"]').filter({ hasText: name });
  {
    await kp2.getByRole("tab", { name: /진행 중/ }).click(); // GM이 PL과 같은 장면을 보게 한다
    await sheetTab(kp2);
    // 1) PL의 시트를 이은 토큰: 그 PL에게 HP 막대가 보이고, 시트의 HP와 같음
    await sheetTab(kp2, CHAR);
    await kp2.getByRole("button", { name: "토큰으로 놓기" }).click();
    const linked = pl.locator('[data-mine="true"][data-linked="true"]').first();
    await linked.waitFor();
    const linkedName = (await linked.getAttribute("data-testid")).slice(4);
    const bar = hpBar(pl, linkedName);
    await bar.waitFor({ state: "attached" });
    await sheetTab(pl);
    const [hp, max] = (await pl.getByTestId("stat-hp").innerText()).split("/").map(Number);
    assert.equal(Number(await bar.getAttribute("data-hp")), hp);
    assert.equal(Number(await bar.getAttribute("data-max")), max);
    // 2) 토큰을 누르면(끌지 않고) 그 시트가 시트 탭에 열림 — PL은 자기 토큰만
    await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
    await linked.dblclick(); // 토큰을 두 번 누르면 시트가 열림(한 번은 선택)
    await pl.getByTestId("sheet-modal").waitFor();
    step("토큰↔시트 연결: PL 자신의 연결 토큰 아래에 시트와 같은 HP 막대가 보이고, 토큰을 두 번 누르면 시트가 열림");

    // 3) NPC 시트를 이은 토큰: GM에게는 HP가 보이고 PL에게는 'HP 공개'를 켤 때까지 안 보임
    await sheetTab(kp2);
    await sheetTab(kp2, NPC);
    await kp2.getByTestId("npc-badge").waitFor();
    await kp2.getByRole("button", { name: "토큰으로 놓기" }).click();
    await pl.getByTestId(`obj-${NPC}`).waitFor();
    await hpBar(kp2, NPC).waitFor({ state: "attached" });
    assert.equal(Number(await hpBar(kp2, NPC).getAttribute("data-max")), 10);
    assert.equal(await hpBar(pl, NPC).count(), 0, "NPC의 HP는 PL에게 숨김");
    await kp2.getByTestId(`pick-${NPC}`).dispatchEvent("click");
    await closeSheet(kp2); await kp2.getByTestId("hp-public").click();
    await hpBar(pl, NPC).waitFor({ state: "attached" });
    await closeSheet(kp2); await kp2.getByTestId("hp-public").click();
    await hpBar(pl, NPC).waitFor({ state: "detached" });
    // PL은 NPC 토큰을 눌러도 NPC 시트를 열지 못한다
    await closeSheet(pl); await pl.getByRole("tab", { name: "굴림" }).click();
    await pl.getByTestId(`obj-${NPC}`).click();
    assert.equal(await pl.getByRole("tab", { name: "시트" }).getAttribute("aria-selected"), "false");
    // GM이 토큰을 누르면 시트가 열림
    await closeSheet(kp2); await kp2.getByRole("tab", { name: "굴림" }).click();
    await kp2.getByTestId(`obj-${NPC}`).dblclick();
    await kp2.getByTestId("sheet-modal").waitFor();
    assert.equal(await kp2.getByTestId("sheet-modal").getByRole("dialog").getAttribute("aria-label"), `시트 · ${NPC}`);
    step("NPC 토큰의 HP는 GM에게만 보이고 'HP 공개'로 PL에게 열고 닫을 수 있으며, GM이 토큰을 두 번 누르면 그 NPC 시트가 열림");

    // 4) 이어지지 않은 토큰에 시트 연결 고르기 → HP 막대, 연결 해제 → 막대 사라짐
    const plain = "연결시험 " + run;
    await kp2.getByLabel("새 토큰 이름").fill(plain);
    await kp2.getByRole("button", { name: "+ 토큰" }).click();
    await kp2.getByTestId(`pick-${plain}`).dispatchEvent("click");
    await kp2.getByLabel("시트 연결").selectOption({ label: NPC });
    await hpBar(kp2, plain).waitFor({ state: "attached" });
    await kp2.getByLabel("시트 연결").selectOption({ label: "시트 연결 없음" });
    await hpBar(kp2, plain).waitFor({ state: "detached" });
    step("선택 막대의 '시트 연결'로 토큰에 시트를 잇고 풀 수 있음(잇는 동안만 HP 막대)");
  }

  // 준비 도구 2: NPC 시트 만들기(빠른 NPC) → 무기·기능 고치기 → 피해 → 토큰 HP 막대 → 시트를 빼면 연결이 풀림
  {
    const N = "불량배 " + run;
    await sheetTab(kp2);
    await kp2.getByTestId("npc-new").click();
    await kp2.getByTestId("npc-name").fill(N);
    await kp2.getByTestId("npc-preset").selectOption({ label: "불량배" });
    assert.match(await kp2.getByTestId("npc-db").innerText(), /피해 보너스/);
    await kp2.getByTestId("npc-create").click();
    await kp2.getByTestId("npc-dialog").waitFor({ state: "detached" });
    await kp2.getByTestId("npc-badge").waitFor();
    await kp2.getByRole("dialog", { name: `시트 · ${N}` }).waitFor();
    await kp2.getByTestId("stat-hp").getByText("12/12").waitFor();
    await kp2.getByTestId("weapon-곤봉").waitFor();
    await hpBar(kp2, N).waitFor({ state: "attached" }); // '토큰도 같이 놓기' 기본값
    assert.equal(Number(await hpBar(kp2, N).getAttribute("data-max")), 12);
    // PL에게는 시트도 HP 막대도 가지 않음
    await pl.getByTestId(`obj-${N}`).waitFor();
    assert.equal(await hpBar(pl, N).count(), 0);
    assert.equal(await pl.getByTestId("sheet-card").filter({ hasText: N }).count(), 0);
    // 무기·기능 고치기(GM)
    await kp2.getByLabel("새 무기 이름").fill("단검");
    await kp2.getByLabel("새 무기 피해").fill("1d4+db");
    await kp2.getByRole("button", { name: "무기 넣기" }).click();
    await kp2.getByTestId("weapon-단검").waitFor();
    await kp2.getByLabel("새 무기 이름").fill("엉터리");
    await kp2.getByLabel("새 무기 피해").fill("엉터리");
    await kp2.getByRole("alert").filter({ hasText: "주사위 식" }).waitFor();
    await kp2.getByLabel("새 무기 이름").fill("");
    await kp2.getByLabel("새 무기 피해").fill("1d6+db");
    await kp2.getByLabel("회피 값 고치기").fill("70");
    await kp2.getByLabel("회피 값 고치기").press("Enter");
    await kp2.waitForFunction(() => document.querySelector('[aria-label="회피 값 고치기"]')?.value === "70");
    await kp2.getByLabel("새 기능 이름").fill("크툴루 신화");
    await kp2.getByLabel("새 기능 값").fill("5");
    await kp2.getByRole("button", { name: "기능 넣기" }).click();
    await kp2.waitForFunction(() => document.querySelector('[aria-label="크툴루 신화 값 고치기"]')?.value === "5");
    // 피해가 시트와 토큰 막대에 함께 적용됨
    await kp2.getByLabel("적용할 피해").fill("4");
    await kp2.getByTestId("sheet-apply-damage").click();
    await kp2.getByTestId("stat-hp").getByText("8/12").waitFor();
    await kp2.waitForFunction((n) => document.querySelector(`[data-testid="obj-${n}"] [data-testid^="hp-"]`)?.getAttribute("data-hp") === "8", N);
    step("NPC 시트 만들기: 빠른 NPC 예시로 HP·무기가 들어가고 토큰이 이어지며, 무기·기능을 고치고 피해를 적용하면 토큰 HP 막대도 줄고, PL에게는 보이지 않음");
    // 시트를 빼면 토큰의 연결이 풀림(토큰은 남음)
    await kp2.getByRole("button", { name: "이 캐릭터 빼기" }).click();
    await confirmAsk(kp2);
    await hpBar(kp2, N).waitFor({ state: "detached" });
    await kp2.getByTestId(`obj-${N}`).waitFor();
    step("시트를 룸에서 빼면 그 시트를 이은 토큰의 연결이 풀리고 토큰은 남음");
  }

  // 입력 한도·탭 줄·초점 복귀(GM, 데스크톱)
  {
    await kp2.getByTestId("scene-add").click();
    const askDlg = kp2.getByTestId("ask-dialog");
    const inp = askDlg.getByLabel("장면 이름");
    await inp.fill("가".repeat(40));
    const note = askDlg.getByTestId("limit-note").first();
    await note.waitFor();
    assert.match(await note.innerText(), /장면 이름은 40자까지예요/);
    assert.equal((await inp.inputValue()).length, 40);
    await kp2.keyboard.press("Escape");
    await askDlg.waitFor({ state: "detached" });
    // 오른쪽 패널의 마지막 탭도 잘리지 않고 눌러진다
    const side = await kp2.getByTestId("side-panel").boundingBox();
    const logTab = kp2.getByRole("tab", { name: /^기록/ });
    await logTab.click();
    const lb = await logTab.boundingBox();
    assert.ok(lb.x >= side.x - 1 && lb.x + lb.width <= side.x + side.width + 1, `기록 탭이 패널 밖이에요 ${JSON.stringify([lb, side])}`);
    // 날짜 칸은 한국어 이름표
    await kp2.getByRole("tab", { name: /^기록/ }).click();
    if (await kp2.getByTestId("log-since").count()) assert.match((await kp2.getByTestId("log-since").getAttribute("aria-label")) ?? "", /시작 일시/);
    await kp2.getByRole("tab", { name: /^굴림/ }).click();
    // 초대 창을 닫으면 초점이 초대 버튼으로 돌아온다
    const invBtn = kp2.getByRole("button", { name: "초대", exact: true });
    await invBtn.click();
    await kp2.getByLabel("초대 링크 주소").waitFor();
    await kp2.keyboard.press("Escape");
    await kp2.waitForFunction(() => document.activeElement?.textContent?.trim() === "초대");
    // 단축키 검색에 '토큰으로 놓기'·'NPC 만들기'가 있다
    await kp2.keyboard.press("Control+k");
    const cueIn = kp2.getByRole("combobox").first();
    await cueIn.fill("NPC").catch(() => {});
    await kp2.keyboard.press("Escape");
    // 시트 탭 위쪽 줄에서 바로 토큰으로 놓기·NPC 만들기가 보인다
    await kp2.getByRole("tab", { name: /^시트/ }).click();
    await kp2.getByTestId("sheet-top").waitFor();
    const top = await kp2.getByTestId("sheet-top").boundingBox();
    assert.ok(top.y < side.y + 160, "시트 탭의 도구 줄이 맨 위에 있어요");
    await kp2.getByRole("tab", { name: /^굴림/ }).click();
  }
  step("입력 한도 안내, 마지막 탭 도달, 날짜 칸 한국어 이름, 초대 창 초점 복귀, 시트 탭 위쪽 도구 줄");
  // 준비 도구 3: 시나리오 가져오기(문서 예시) — 미리보기, 적용, 되돌리기
  const fsx = await import("node:fs/promises");
  const doc = await fsx.readFile(new URL("../../../docs/scenario-format.md", import.meta.url), "utf8");
  const SAMPLE = doc.match(/```json\n([\s\S]*?)\n```/)[1];
  const sceneTabs = () => kp2.getByRole("tablist", { name: "장면" }).getByRole("tab");
  const sceneNames = async () => (await sceneTabs().allInnerTexts()).map((t) => t.replace(/^[●▶\s]+/, "").trim());
  const waitNames = async (ok) => {
    for (let i = 0; i < 60; i++) {
      const n = await sceneNames();
      if (ok(n)) return n;
      await kp2.waitForTimeout(100);
    }
    throw new Error("장면 목록이 기대대로 바뀌지 않았어요: " + (await sceneNames()).join(","));
  };
  const homeTab = () => sceneTabs().filter({ hasText: /^[●▶\s]*현관$/ }).first();
  {
    const before = await sceneNames();
    await openSettings(kp2);
    await kp2.getByTestId("menu-import").click();
    const dlg = kp2.getByTestId("import-dialog");
    // 깨진 글은 위치와 이유를 알려 주고 가져오기가 막힘
    await dlg.getByTestId("import-text").fill('{"format":"roll-and-call-scenario","version":2,"roomName":"X","scenes":[{"key":"a","name":"방"}],"tokens":[{"scene":"없는장면","kind":"prop","name":"상자","x":1,"y":1}]}');
    await dlg.getByTestId("import-errors").getByText(/없는장면/).waitFor();
    assert.equal(await dlg.getByTestId("import-apply").isDisabled(), true);
    {
      const ta = dlg.getByTestId("import-text");
      assert.ok(Number(await ta.getAttribute("rows")) >= 10, "붙여넣는 칸은 10줄 이상");
      assert.ok((await ta.boundingBox()).height >= 150, "붙여넣는 칸이 너무 낮아요");
      assert.notEqual(await ta.evaluate((e) => getComputedStyle(e).resize), "none", "크기를 조절할 수 있어요");
      const errText = await dlg.getByTestId("import-errors").innerText();
      assert.match(errText, /번째 토큰·소품/);
      assert.doesNotMatch(errText, /tokens\[/, "영어 경로가 그대로 보여요");
      // 쉼표가 빠진 JSON: 줄·칸 위치가 한국어로
      await ta.fill('{\n  "format": "roll-and-call-scenario",\n  "version": 2\n  "roomName": "X"\n}');
      await dlg.getByTestId("import-errors").getByText(/번째 줄/).waitFor();
      assert.match(await dlg.getByTestId("import-errors").innerText(), /JSON 형식이 맞지 않아요/);
      // 겹친 장면 key
      await ta.fill('{"format":"roll-and-call-scenario","version":2,"roomName":"X","scenes":[{"key":"a","name":"방"},{"key":"a","name":"방2"}]}');
      await dlg.getByTestId("import-errors").getByText(/겹쳐요/).waitFor();
      assert.match(await dlg.getByTestId("import-errors").innerText(), /2번째 장면/);
      await ta.fill('{"format":"roll-and-call-scenario","version":2,"roomName":"X","scenes":[{"key":"a","name":"방"}],"tokens":[{"scene":"없는장면","kind":"prop","name":"상자","x":1,"y":1}]}');
      await dlg.getByTestId("import-errors").getByText(/없는장면/).waitFor();
    }
    // 예시 받기
    const [sampleDl] = await Promise.all([kp2.waitForEvent("download"), dlg.getByTestId("import-sample").click()]);
    const sampleFile = JSON.parse((await fsx.readFile(await sampleDl.path())).toString("utf8"));
    assert.equal(sampleFile.format, "roll-and-call-scenario");
    // 문서의 예시를 파일로 고르면 미리보기에 개수가 나옴
    await dlg.getByTestId("import-file").setInputFiles({ name: "예시.json", mimeType: "application/json", buffer: Buffer.from(SAMPLE) });
    await dlg.getByTestId("import-counts").waitFor();
    const countsText = await dlg.getByTestId("import-counts").innerText();
    assert.match(countsText, /장면 2/);
    assert.match(countsText, /토큰·소품 4/);
    assert.match(countsText, /핸드아웃 3/);
    assert.match(countsText, /이미지 1/);
    assert.equal(await dlg.getByTestId("import-errors").count(), 0);
    await dlg.getByTestId("import-apply").click();
    await dlg.waitFor({ state: "detached" });
    const after = await waitNames((n) => n.includes("지하실"));
    assert.ok(after.includes("현관"));
    assert.equal(after.length, before.length + 2, "장면 2개가 더해짐");
    const toast = kp2.getByTestId("toast").filter({ hasText: "가져왔어요" });
    await toast.waitFor();
    // PL: 공개 핸드아웃은 받고 GM 전용 노트·NPC 시트는 받지 않음
    await pl.getByRole("tab", { name: /^핸드아웃/ }).click();
    await pl.getByText("찢어진 쪽지").waitFor();
    assert.equal(await pl.getByText("관리인의 비밀").count(), 0);
    assert.equal(await pl.getByTestId("sheet-card").filter({ hasText: SECRET_NPC }).count(), 0);
    // 되돌리기 토스트
    await toast.getByTestId("toast-action").click();
    await waitNames((n) => !n.includes("지하실"));
    assert.equal((await sceneNames()).length, before.length);
    step("시나리오 가져오기: 깨진 글은 위치와 함께 막히고, 문서 예시는 개수 미리보기 뒤 적용되며(PL은 공개 핸드아웃만 받음) '되돌리기' 토스트로 지워짐");

    // 다시 가져와서 아래 단계에 쓴다(붙여넣기로)
    await openSettings(kp2);
    await kp2.getByTestId("menu-import").click();
    await kp2.getByTestId("import-text").fill(SAMPLE);
    await kp2.getByTestId("import-counts").waitFor();
    await kp2.getByTestId("import-apply").click();
    await waitNames((n) => n.includes("지하실"));
    step("글을 붙여 넣어도 같은 미리보기·적용이 됨");
  }

  // 준비 도구 4: 장면 복제·순서·이름 바꾸기·삭제(화면 안 대화상자)
  {
    const orig = await sceneNames();
    await homeTab().click();
    await kp2.getByTestId("obj-낡은 상자").waitFor();
    await openSceneMenu(kp2);
    await kp2.getByTestId("scene-duplicate").click();
    await sceneTabs().filter({ hasText: "현관 복사" }).waitFor();
    await kp2.waitForFunction(() => [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.includes("현관 복사") && t.getAttribute("aria-selected") === "true"));
    await kp2.getByTestId("obj-낡은 상자").waitFor(); // 오브젝트도 복사됨
    let names = await sceneNames();
    assert.equal(names.indexOf("현관 복사"), names.indexOf("현관") + 1, "원본 바로 뒤에 놓임");
    // 순서: 앞으로 → 원본 앞, 뒤로 → 다시 뒤
    await openSceneMenu(kp2);
    await kp2.getByTestId("scene-move-up").click();
    names = await waitNames((n) => n.indexOf("현관 복사") < n.indexOf("현관"));
    await openSceneMenu(kp2);
    await kp2.getByTestId("scene-move-down").click();
    names = await waitNames((n) => n.indexOf("현관 복사") > n.indexOf("현관"));
    // 순서: 탭을 끌어서 바꾸기(복사본을 원본의 왼쪽 절반에 놓으면 원본 앞, 오른쪽 절반에 놓으면 뒤)
    {
      const wraps = kp2.getByTestId("scene-tab-wrap");
      const copyTab = () => wraps.filter({ hasText: "현관 복사" });
      const origTab = () => wraps.filter({ hasText: /현관(?! 복사)/ });
      await copyTab().dragTo(origTab(), { targetPosition: { x: 4, y: 10 } });
      await waitNames((n) => n.indexOf("현관 복사") < n.indexOf("현관"));
      const ob = await origTab().boundingBox();
      await copyTab().dragTo(origTab(), { targetPosition: { x: Math.max(ob.width - 4, 6), y: 10 } });
      await waitNames((n) => n.indexOf("현관 복사") > n.indexOf("현관"));
      // 자기 자신 위에 놓으면 아무 일도 없음
      const before = await sceneNames();
      await copyTab().dragTo(copyTab(), { targetPosition: { x: 4, y: 10 } });
      assert.deepEqual(await sceneNames(), before, "제자리에 놓으면 순서가 그대로");
    }
    // 이름 바꾸기(화면 안 대화상자)
    const NEW = "현관홀 " + run;
    await openSceneMenu(kp2);
    await kp2.getByRole("button", { name: "이름 변경" }).click();
    const ask = kp2.getByTestId("ask-dialog");
    await ask.getByLabel("장면 이름").fill(NEW);
    await ask.locator('button[type="submit"]').click();
    await waitNames((n) => n.includes(NEW));
    // 삭제(활성이 아닌 장면): 확인 창 → 사라짐
    await openSceneMenu(kp2);
    await kp2.getByRole("button", { name: "장면 삭제" }).click();
    await confirmAsk(kp2);
    await waitNames((n) => !n.includes(NEW));
    assert.deepEqual(await sceneNames(), orig);
    step("장면 복제(오브젝트까지)·앞으로/뒤로·탭 끌어서 순서·이름 변경·삭제가 화면 안 대화상자로 동작함");
  }

  // 준비 도구 5: 룸 내보내기(백업) → 로비에서 백업으로 새 룸 만들기
  {
    await openSettings(kp2);
    await kp2.getByTestId("export-sheets").check();
    const [dl] = await Promise.all([kp2.waitForEvent("download"), kp2.getByTestId("menu-export-backup").click()]);
    const backupText = (await fsx.readFile(await dl.path())).toString("utf8");
    await kp2.keyboard.press("Escape");
    const backup = JSON.parse(backupText);
    assert.equal(backup.format, "roll-and-call-backup");
    assert.ok(backup.scenes.some((sc) => sc.name === "현관") && backup.scenes.some((sc) => sc.name === "지하실"));
    assert.ok(backup.characters.length >= 2, "시트 포함을 켜면 시트가 담김");
    assert.ok(!backupText.includes("abcdefghijklmnopqrstuvwxyz"), "웹훅 주소는 담기지 않음");
    assert.ok(!backupText.includes("하늘"), "접속한 사람의 정보는 담기지 않음");
    const secret = backup.handouts.find((h) => h.title.includes("관리인의 비밀"));
    assert.ok(secret && secret.visibleTo === "gm", "GM 전용 노트는 GM 전용으로 남음");
    // 로비: 백업에서 새 룸 만들기
    const home = await (await ctx()).newPage();
    await login(home, "하늘");
    await home.getByTestId("import-room").click();
    const rd = home.getByTestId("import-room-dialog");
    await rd.getByTestId("import-room-file").setInputFiles({ name: "백업.json", mimeType: "application/json", buffer: Buffer.from(backupText) });
    await rd.getByTestId("import-room-counts").getByText(/장면/).waitFor();
    await rd.getByLabel("새 룸 이름").fill(`복원 룸 ${run}`);
    await rd.getByTestId("import-room-apply").click();
    await home.waitForURL((u) => /\/room\//.test(u.toString()) && u.toString() !== roomUrl);
    await home.getByTestId("connection").getByText("연결됨").waitFor();
    await home.getByRole("tablist", { name: "장면" }).getByRole("tab", { name: "지하실" }).waitFor();
    await home.getByRole("tab", { name: /^[●▶\s]*현관$/ }).first().click();
    await home.getByTestId("obj-낡은 상자").waitFor();
    await home.getByText("세션 시작 전이에요").waitFor();
    // 원래 룸은 그대로
    assert.ok((await sceneNames()).includes("현관"));
    step("룸 내보내기: 시트까지 담은 백업(웹훅·접속자 정보 없음, GM 노트는 GM 전용)을 로비의 '백업에서 새 룸 만들기'로 새 룸에 되살리고 원래 룸은 그대로");
  }

  // 룸 이름 바꾸기(주인) → 탭 제목에 반영
  {
    await openSettings(kp2);
    await kp2.getByTestId("menu-rename-room").click();
    const ask = kp2.getByTestId("ask-dialog");
    await ask.getByLabel("룸 이름").fill(`${ROOM} 개정`);
    await ask.locator('button[type="submit"]').click();
    await kp2.waitForFunction((n) => document.title.includes(n), `${ROOM} 개정`);
    step("룸 주인이 룸 이름을 바꾸면 탭 제목이 바뀜");
  }


  // ── 휴대폰·태블릿: 터치로 GM과 PL이 모두 쓸 수 있다 ──
  {
    const SHOTD = process.env.B5_SHOTS ?? "/tmp/claude-0/-home-claude/67ca7b5b-0635-57ed-b16a-c1834c783582/scratchpad/b7ux-shots";
    const mctx = async (w, h) => {
      const c = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      c.setDefaultTimeout(Number(process.env.E2E_TIMEOUT_MS ?? 30000));
      return c;
    };
    const touchSeq = async (page, steps) => {
      const cdp = await page.context().newCDPSession(page);
      for (const pts of steps) {
        await cdp.send("Input.dispatchTouchEvent", { type: pts.length ? "touchMove" : "touchEnd", touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
        await page.waitForTimeout(16);
      }
      await cdp.detach();
    };
    const touchDrag = async (page, from, to) => {
      const cdp = await page.context().newCDPSession(page);
      const tp = (x, y) => [{ x, y, id: 0 }];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp(from.x, from.y) });
      for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    };
    const touchPinch = async (page, c, from, to) => {
      const cdp = await page.context().newCDPSession(page);
      const two = (d) => [{ x: c.x - d, y: c.y, id: 0 }, { x: c.x + d, y: c.y, id: 1 }];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: two(from) });
      for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: two(from + ((to - from) * i) / 8) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    };
    const centerOf = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const zoomOf = async (page) => Number(await page.getByTestId("board").getAttribute("data-zoom"));
    const big = async (loc, what, min = 44) => { const b = await loc.boundingBox(); assert.ok(b && b.width >= min - 0.5 && b.height >= min - 0.5, `${what} 크기 ${b && Math.round(b.width)}x${b && Math.round(b.height)}`); };
    const inside = (b, o) => b.x >= o.x - 1 && b.y >= o.y - 1 && b.x + b.width <= o.x + o.width + 1 && b.y + b.height <= o.y + o.height + 1;
    const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    await (await import("node:fs/promises")).mkdir(SHOTD, { recursive: true });
    // 휴대폰에서는 보기 도구(확대·맞춤·내 토큰)가 접혀 있다: 펼친 뒤에 쓴다
    const openZoom = async (page) => { const t = page.getByTestId("zoom-toggle"); if (await t.isVisible() && (await t.getAttribute("aria-expanded")) !== "true") await t.click(); };

    // 방 만들기와 입장은 데스크톱 쪽으로 하고, 휴대폰 화면 둘이 같은 룸에 들어간다
    const gmC = await mctx(390, 844);
    const gm = await gmC.newPage();
    await login(gm, "모바GM" + run);
    await gm.getByLabel("새 룸 이름").fill("모바일방 " + run);
    await gm.getByRole("button", { name: "새 룸 만들기", exact: true }).click();
    await gm.waitForURL(/\/room\//);
    await gm.getByTestId("board").waitFor();
    assert.equal(await gm.evaluate(() => matchMedia("(pointer: coarse)").matches), true);
    const vh = 844;
    const boardH = async (p) => (await p.getByTestId("board").boundingBox()).height;
    assert.ok((await boardH(gm)) >= vh * 0.55, `접힌 도구 묶음 아래 보드 높이 ${await boardH(gm)}`);
    await gm.getByTestId("tool-sheet").waitFor();
    const quick = gm.getByTestId("quick-token");
    await big(quick, "+ 토큰");
    // 초대 링크
    await gm.getByRole("button", { name: "초대", exact: true }).click();
    const minv = await gm.getByLabel("초대 링크 주소").inputValue();
    await gm.keyboard.press("Escape");
    await gm.getByRole("button", { name: "세션 시작" }).click();
    await gm.getByTestId("session-status").getByText("진행 중").waitFor();
    step("휴대폰 GM: 접은 도구 묶음 아래에서도 보드가 화면의 55% 이상이고 '+ 토큰'이 44px 이상으로 보임");

    // 토큰 두 개를 놓고 터치로 끈다
    await quick.click();
    await gm.locator('circle[r="24"]').first().waitFor();
    const tok = gm.locator('[data-testid^="obj-"]').first();
    const t0 = { x: Number(await tok.getAttribute("data-x")), y: Number(await tok.getAttribute("data-y")) };
    const c0 = await centerOf(gm.locator('circle[r="24"]').first());
    await touchDrag(gm, c0, { x: c0.x + 80, y: c0.y + 60 });
    await gm.waitForFunction(([x, y]) => { const e = document.querySelector('[data-testid^="obj-"]'); return e && Math.abs(Number(e.getAttribute("data-x")) - x) > 40; }, [t0.x, t0.y]);
    step("휴대폰: 손가락으로 토큰을 끌어 옮김");

    // 확대: 버튼과 두 손가락 모으기
    const z0 = await zoomOf(gm);
    assert.equal(await gm.getByRole("button", { name: "확대", exact: true }).isVisible(), false, "휴대폰의 보기 도구는 접혀 있어요");
    await openZoom(gm);
    await gm.getByRole("button", { name: "확대" }).click();
    assert.ok((await zoomOf(gm)) > z0);
    await gm.getByTestId("zoom-fit").click();
    assert.equal(await zoomOf(gm), 1);
    const bb = await gm.getByTestId("board").boundingBox();
    await touchPinch(gm, { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }, 30, 110);
    await gm.waitForFunction(() => Number(document.querySelector('[data-testid="board"]').getAttribute("data-zoom")) > 1.5);
    const zKeep = await zoomOf(gm);
    await gm.waitForTimeout(500); // 보기는 잠깐 모아서 저장돼요
    await gm.reload();
    await gm.getByTestId("board").waitFor();
    await gm.waitForFunction((z) => Math.abs(Number(document.querySelector('[data-testid="board"]').getAttribute("data-zoom")) - z) < 0.05, zKeep);
    await openZoom(gm);
    await gm.getByTestId("zoom-fit").click();
    step("휴대폰: 확대·맞춤 버튼과 두 손가락 모으기가 되고, 장면별 확대가 새로고침 뒤에도 남음");

    // 도구 묶음 펼치기·접기: '+ 토큰'이 가려지지 않고 보드는 줄어들지 않는다
    {
      const h0 = await boardH(gm);
      await gm.getByTestId("sheet-handle").click();
      await gm.getByTestId("tool-sheet-body").waitFor();
      const q = await quick.boundingBox();
      const sheet = await gm.getByTestId("tool-sheet-body").boundingBox();
      assert.ok(!overlap(q, sheet), "펼친 묶음이 + 토큰을 덮어요");
      assert.ok(q.y + q.height <= vh, "+ 토큰이 화면 안에 있어요");
      await gm.screenshot({ path: `${SHOTD}/phone-gm-sheet-open.png` });
      await gm.getByTestId("sheet-tab-select").click();
      await gm.getByTestId("sheet-handle").click();
      await gm.getByTestId("tool-sheet-body").waitFor({ state: "hidden" });
      assert.ok(Math.abs((await boardH(gm)) - h0) < 2, "접으면 보드 높이가 돌아와요");
    }
    step("휴대폰 GM: 도구 묶음을 펼쳐도 '+ 토큰'이 안 가려지고, 접으면 보드 높이가 그대로 돌아옴");

    // 토큰 선택 → 지우기 → 되돌리기 알림이 버튼을 가리지 않는다
    {
      const c = await centerOf(gm.locator('circle[r="24"]').first());
      await gm.touchscreen.tap(c.x, c.y);
      await gm.getByTestId("quick-select").waitFor();
      await gm.keyboard.press("Delete").catch(() => {});
      if (!(await gm.getByRole("button", { name: "되돌리기" }).count())) {
        await gm.getByTestId("sheet-handle").click();
        await gm.getByRole("button", { name: /^삭제|지우기/ }).first().click();
      }
      const undoBtn = gm.getByRole("button", { name: "되돌리기" }).first();
      await undoBtn.waitFor();
      const ub = await undoBtn.boundingBox();
      const qb = await quick.boundingBox();
      assert.ok(!overlap(ub, qb), "되돌리기 알림이 + 토큰을 덮어요");
      await big(undoBtn, "되돌리기", 40);
      await undoBtn.click();
      await gm.locator('circle[r="24"]').first().waitFor();
      if ((await gm.getByTestId("tool-sheet-body").isVisible())) await gm.getByTestId("sheet-handle").click();
    }
    step("휴대폰 GM: 지운 토큰을 알림의 '되돌리기'로 살림(알림이 도구를 가리지 않음)");

    // PL 휴대폰
    const plC = await mctx(390, 844);
    const mpl = await plC.newPage();
    await mpl.goto(minv);
    await mpl.getByLabel("이름").fill("모바PL" + run);
    await mpl.getByRole("button", { name: "계속하기" }).click();
    await mpl.getByRole("button", { name: "PL로 입장" }).click();
    await mpl.getByTestId("board").waitFor();
    await mpl.getByTestId("panel-dock").waitFor();
    assert.ok((await boardH(mpl)) >= vh * 0.55, `PL 보드 높이 ${await boardH(mpl)}`);
    for (const id of ["dock-roll", "dock-sheet", "dock-chat"]) await big(mpl.getByTestId(id), id);
    await mpl.getByTestId("dock-roll").click();
    const rollIn = mpl.getByLabel("굴림 식");
    await rollIn.waitFor();
    await mpl.waitForTimeout(500);
    assert.ok((await rollIn.boundingBox()).y > vh * 0.4, "굴림 입력이 아래쪽 손 닿는 곳에 있어요");
    await rollIn.fill("1d20");
    const rollBtn = mpl.getByRole("button", { name: "굴리기" }).first();
    await mpl.waitForTimeout(500); // 서랍이 올라오는 동안은 재지 않는다
    const rb = await rollBtn.boundingBox();
    await mpl.screenshot({ path: `${SHOTD}/phone-pl-roll-open.png` });
    assert.ok(rb.y + rb.height <= vh && rb.y >= 0, `굴리기 버튼이 화면 안에 있어요 ${JSON.stringify(rb)}`);
    await rollBtn.click();
    await mpl.getByTestId("roll-log").getByText(/1d20/).first().waitFor().catch(async () => { await mpl.getByText(/1d20/).first().waitFor(); });
    await mpl.screenshot({ path: `${SHOTD}/phone-pl-roll.png` });
    step("휴대폰 PL: 아래 막대 버튼이 44px 이상이고 굴림 창이 손 닿는 곳에 열려 판정이 굴려짐");

    // 룸 안에서 캐릭터 만들기
    await mpl.getByRole("tab", { name: /^시트/ }).click();
    const mk = mpl.getByTestId("create-in-room");
    await mk.waitFor();
    await big(mk, "캐릭터 만들기");
    await mk.click();
    const dlg = mpl.getByTestId("create-dialog");
    await dlg.waitFor();
    const CH = "모바캐릭터 " + run;
    await dlg.getByLabel("이름", { exact: true }).fill(CH);
    await dlg.getByLabel("나이").fill("25");
    await dlg.getByLabel("직업", { exact: true }).fill("기자");
    await dlg.getByRole("button", { name: "다음" }).click();
    for (const [k, v] of Object.entries({ STR: 60, CON: 50, SIZ: 60, DEX: 50, APP: 50, INT: 60, POW: 50, EDU: 70 })) await dlg.getByLabel(`${k} 기본값`).fill(String(v));
    // 나이 보정의 교육 향상 판정을 안 하면 막히고, 이유가 보이며, 누르면 풀린다
    assert.match(await dlg.getByTestId("wizard-next-why").innerText(), /교육 향상 판정/);
    await dlg.getByTestId("edu-roll").click();
    await dlg.getByTestId("edu-result").waitFor();
    const nextBtn = async () => {
      const b = dlg.getByRole("button", { name: "다음" });
      if (await b.isDisabled()) { await mpl.screenshot({ path: `${SHOTD}/phone-pl-wizard-blocked.png` }); throw new Error("다음이 막혔어요: " + (await dlg.getByTestId("wizard-next-why").innerText().catch(() => "이유 없음"))); }
      await b.click();
    };
    await nextBtn();
    await nextBtn();
    await dlg.getByRole("button", { name: "캐릭터 만들기" }).click();
    await dlg.waitFor({ state: "detached" });
    await mpl.getByText(CH).first().waitFor();
    const vault = await fetch(`${API}/characters`, { headers: { "x-dev-user": encodeURIComponent(("모바PL" + run).toLowerCase()), "x-dev-name": encodeURIComponent("모바PL" + run) } }).then((r) => r.json());
    assert.ok(vault.some((c) => c.name === CH), "보관함에도 저장돼요");
    step("휴대폰 PL: 룸의 시트 탭에서 캐릭터 만들기 마법사를 끝내면 룸에 올라가고 보관함에도 저장됨");

    // 토큰을 받고 '내 토큰'으로 이동·터치 이동
    // 토큰 요청: 캐릭터를 다 만든 PL 은 보드 아래 안내에서 GM 에게 토큰을 부탁하고, GM 은 알림의 한 번 누르기로 놓는다
    await mpl.getByTestId("drawer-close").click();
    const reqBtn = mpl.getByTestId("request-token");
    await reqBtn.waitFor();
    await big(reqBtn, "토큰 요청", 40);
    assert.match(await mpl.getByTestId("no-token-hint").innerText(), /토큰/);
    await reqBtn.click();
    await mpl.getByRole("button", { name: "요청했어요" }).waitFor();
    const ask = gm.getByTestId("toast").filter({ hasText: /토큰을 요청했어요/ });
    await ask.waitFor();
    assert.match(await ask.innerText(), /모바PL.*가 토큰을 요청했어요|모바PL.*이 토큰을 요청했어요/);
    await ask.getByTestId("toast-action").click();
    await mpl.locator('[data-mine="true"]').first().waitFor();
    assert.equal(await mpl.getByTestId("request-token").count(), 0, "토큰이 놓이면 요청 버튼은 사라져요");
    step("휴대폰 PL: 'GM에게 토큰 요청' → GM 알림의 '토큰 놓기' 한 번으로 PL 토큰이 놓임");
    await mpl.waitForTimeout(500);
    await openZoom(mpl);
    await mpl.getByTestId("focus-mine").click();
    const mc = await centerOf(mpl.locator('[data-mine="true"] circle').first());
    const mx0 = Number(await mpl.locator('[data-mine="true"]').first().getAttribute("data-x"));
    await touchDrag(mpl, mc, { x: mc.x + 70, y: mc.y });
    await mpl.waitForFunction((x) => Math.abs(Number(document.querySelector('[data-mine="true"]').getAttribute("data-x")) - x) > 10, mx0);
    await mpl.screenshot({ path: `${SHOTD}/phone-pl.png` });
    step("휴대폰 PL: '내 토큰' 버튼으로 찾아가 손가락으로 옮길 수 있음");

    await gm.screenshot({ path: `${SHOTD}/phone-gm.png` });
    // 코치 대신 ≥44px: 주요 조작
    await openZoom(gm);
    for (const loc of [gm.getByRole("button", { name: "확대" }), gm.getByTestId("sheet-handle"), gm.getByTestId("zoom-fit"), gm.getByTestId("zoom-toggle")]) await big(loc, "주요 조작");
    step("휴대폰: 확대·맞춤·도구 묶음 손잡이가 44px 이상");

    // 태블릿 820x1180
    const tbC = await mctx(820, 1180);
    const tb = await tbC.newPage();
    await login(tb, "모바GM" + run);
    await tb.getByTestId("room-card").filter({ hasText: "모바일방 " + run }).getByRole("link").first().click().catch(async () => { await tb.getByText("모바일방 " + run).first().click(); });
    await tb.waitForURL(/\/room\//);
    await tb.getByTestId("board").waitFor();
    const board = await tb.getByTestId("board").boundingBox();
    const side = await tb.getByTestId("side-panel").boundingBox();
    assert.ok(board.width > 400 && board.x + board.width <= side.x + 1, `지도가 옆 패널에 가려지면 안 돼요 ${JSON.stringify([board, side])}`);
    for (const name of [/\+ 소품/, /\+ GM 전용/]) {
      const b = tb.getByRole("button", { name }).first();
      if (await b.count()) { const bx2 = await b.boundingBox(); assert.ok(bx2.x >= 0 && bx2.x + bx2.width <= 820, `${name} 가 잘려요`); }
    }
    for (const loc of [tb.getByRole("button", { name: "+ 토큰", exact: true }), tb.getByRole("button", { name: "확대" }), tb.getByTestId("zoom-fit")]) await big(loc, "태블릿 조작");
    await tb.screenshot({ path: `${SHOTD}/tablet-gm.png` });
    step("태블릿 820px: 지도가 옆 패널에 가려지지 않고 버튼이 잘리지 않으며 주요 조작이 44px 이상");

    // 네 가지 화면 크기: 겹침·잘림 검사(알림·선택 줄·되돌리기·장면 막대·보기 도구가 서로 안 겹침)
    for (const [w, h, nm] of [[1440, 900, "desktop"], [1366, 768, "laptop"], [820, 1180, "tablet"], [390, 844, "phone"]]) {
      const dc = nm === "tablet" || nm === "phone" ? await mctx(w, h) : await browser.newContext({ viewport: { width: w, height: h } });
      dc.setDefaultTimeout(Number(process.env.E2E_TIMEOUT_MS ?? 30000));
      const dp = await dc.newPage();
      await login(dp, "모바GM" + run);
      await dp.getByTestId("room-card").filter({ hasText: "모바일방 " + run }).getByRole("link").first().click();
      await dp.waitForURL(/\/room\//);
      await dp.getByTestId("board").waitFor();
      await dp.getByTestId("scenebar").waitFor();
      const boxes = async (extra = {}) => {
        const sel = { scenebar: '[data-testid="scenebar"]', zoom: '[data-testid="zoom-ctl"]', selected: '[data-testid="selected-bar"]:visible', undo: ".undo-ctl", toast: ".toasts", sheet: '[data-testid="tool-sheet"]', dock: '[data-testid="panel-dock"]', sceneName: '[data-testid="scene-name"]', banner: ".banner-stack", ...extra };
        const out = {};
        for (const [k, q] of Object.entries(sel)) {
          const l = dp.locator(q).first();
          if ((await l.count()) && (await l.isVisible())) out[k] = await l.boundingBox();
        }
        return out;
      };
      const check = (b, what) => {
        const keys = Object.keys(b);
        for (const k of keys) assert.ok(b[k].x >= -1 && b[k].y >= -1 && b[k].x + b[k].width <= w + 1 && b[k].y + b[k].height <= h + 1, `${nm} ${what}: ${k} 가 화면 밖 ${JSON.stringify(b[k])}`);
        for (let a = 0; a < keys.length; a++) for (let c = a + 1; c < keys.length; c++) {
          const A = b[keys[a]], B = b[keys[c]];
          assert.ok(!overlap(A, B), `${nm} ${what}: ${keys[a]} 와 ${keys[c]} 가 겹쳐요 ${JSON.stringify([A, B])}`);
        }
      };
      // 휴대폰은 선택 줄이 접힌 도구 묶음 안에 있다: 펼쳐서 보고 다시 접는다
      const withSel = async (fn) => {
        if (nm !== "phone") { await dp.locator('[data-testid="selected-bar"]:visible').first().waitFor(); return fn(); }
        await dp.getByTestId("sheet-handle").click();
        await dp.getByTestId("sheet-tab-select").click();
        await dp.locator('[data-testid="selected-bar"]:visible').first().waitFor();
        await dp.waitForTimeout(400);
        await fn();
        await dp.getByTestId("sheet-handle").click();
        await dp.getByTestId("tool-sheet-body").waitFor({ state: "hidden" });
        await dp.locator('[data-testid^="pick-"]').first().focus();
        await dp.keyboard.press("Enter");
      };
      await dp.waitForTimeout(400);
      if (nm === "phone") assert.ok((await dp.getByTestId("scenebar").boundingBox()).height < 60, "휴대폰 장면 막대는 한 줄이에요");
      if (nm === "tablet" || nm === "phone") assert.ok((await dp.getByTestId("scene-select").count()) > 0, "작은 화면의 장면 막대는 드롭다운이에요");
      await openZoom(dp);
      check(await boxes(), "기본");
      await dp.screenshot({ path: `${SHOTD}/${nm}-gm.png` });
      // 토큰을 고르고 움직이면(되돌리기가 생김) 선택 줄·되돌리기가 함께 보이고 서로 안 겹친다
      const pickBtn = dp.locator('[data-testid^="pick-"]').first();
      await pickBtn.focus();
      await dp.keyboard.press("Enter");
      await dp.keyboard.press("ArrowRight");
      await dp.getByRole("button", { name: "되돌리기" }).first().waitFor();
      await dp.waitForTimeout(300);
      await withSel(async () => check(await boxes(), "선택·되돌리기"));
      await dp.screenshot({ path: `${SHOTD}/${nm}-gm-selected.png` });
      // 지우면 알림이 뜬다: 알림은 되돌리기·선택 줄·보기 도구·장면 막대와 겹치지 않는다
      await dp.keyboard.press("Delete");
      await dp.getByTestId("toast").first().waitFor();
      await dp.waitForTimeout(300);
      check(await boxes(), "알림");
      await dp.screenshot({ path: `${SHOTD}/${nm}-gm-toast.png` });
      // 한 번 더: 알림이 떠 있는 채로 토큰을 다시 고르면 알림이 선택 줄 위로 올라간다
      const undoBtn = dp.getByRole("button", { name: "되돌리기" }).first();
      if (await undoBtn.isVisible()) await undoBtn.click();
      await dp.locator('[data-testid^="pick-"]').first().waitFor({ state: "attached" });
      await dp.locator('[data-testid^="pick-"]').first().focus();
      await dp.keyboard.press("Enter");
      await withSel(async () => {
        check(await boxes(), "되돌린 뒤");
        assert.ok(await dp.locator('[data-testid="selected-bar"]:visible').first().getByText("소유자", { exact: true }).isVisible(), "소유자 이름표가 보여야 해요");
      });
      await dc.close();
    }
    step("1440x900·1366x768·820x1180·390x844: 알림·선택 줄·되돌리기·장면 막대·보기 도구가 화면 안에서 서로 겹치지 않음");
    await gmC.close(); await plC.close(); await tbC.close();
  }

  // 룸 삭제: 로비 카드에서 두 번 눌러 지우면 목록에서 사라지고, 열려 있던 룸은 끊긴다
  await kp2.goto(WEB);
  const card = kp2.getByTestId("room-card").filter({ hasText: ROOM });
  await card.getByRole("button", { name: /룸 삭제$/ }).click();
  await card.getByRole("button", { name: "지우기" }).click();
  await card.waitFor({ state: "detached" });
  await pl.getByText("룸을 찾을 수 없어요").waitFor();
  step("룸 주인이 룸을 지우면 목록에서 사라지고 참가자 화면은 안내로 바뀜");

  await pl.screenshot({ path: process.env.SHOT ?? "/tmp/room-pl.png" });
  await kp2.screenshot({ path: process.env.SHOT_KP ?? "/tmp/room-kp.png" });
  console.log("\n모든 확인 통과");
} catch (e) {
  console.error("\n실패:", e.message);
  if (process.env.E2E_DEBUG) {
    console.error(e.stack); // 어느 줄에서 멈췄는지 보고 싶을 때
    for (const [i, p] of (globalThis.__pages ?? []).entries()) await p.screenshot({ path: `${SHOTS}/fail-${i}.png` }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
