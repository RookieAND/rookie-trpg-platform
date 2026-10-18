// 두 브라우저(KP, PL)로 실제 화면을 조작해 실시간 동작을 확인한다.
// 사전 조건: pnpm dev:realtime(=api), pnpm dev:web 이 떠 있어야 한다.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const WEB = process.env.WEB_URL ?? "http://localhost:3000";
// API 주소. 다른 포트로 띄운 서버에 돌릴 때 API_URL로 알려 준다.
const API = process.env.API_URL ?? "http://localhost:8787";
const exe = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--no-proxy-server", "--disable-dev-shm-usage"] });
// 느린 개발 서버·바쁜 머신에서도 흔들리지 않게 기본 대기를 넉넉히 둔다(E2E_TIMEOUT_MS로 조절).
const ctx = async () => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  c.setDefaultTimeout(Number(process.env.E2E_TIMEOUT_MS ?? 30000));
  return c;
};
// 같은 서버로 여러 번 돌려도 이전 실행의 룸·캐릭터와 섞이지 않게 이름에 실행 번호를 붙인다.
const run = Date.now().toString(36);
const ROOM = `안개 낀 저택 ${run}`;
const CHAR = `윤서하 ${run}`;
const SHOTS = process.env.SHOTS_DIR ?? "/tmp/shots-pltools";
await (await import("node:fs/promises")).mkdir(SHOTS, { recursive: true });
const step = (m) => console.log("✓", m);
// 설정·장면 설정 메뉴 안의 항목은 메뉴를 먼저 열어야 보인다. 쓰고 나면 Esc로 닫아 아래 화면을 가리지 않게 한다.
const openSettings = async (page) => { if (!(await page.getByRole("menu").count())) await page.getByTestId("settings-menu").click(); };
// 판정 요청 폼과 안개 더보기는 접혀 있다. 필요할 때 펼친다.
const openAsk = async (page) => { if (!(await page.getByLabel("요청할 기능").count())) await page.getByRole("button", { name: "판정 요청" }).click(); };
const openFogMore = async (page) => { const b = page.getByTestId("fog-toolbar").getByRole("button", { name: /^더보기|^접기/ }); if ((await b.getAttribute("aria-expanded")) !== "true") await b.click(); };
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
  await page.getByLabel("이름").fill(name);
  await page.getByRole("button", { name: "시작하기" }).click();
};

try {
  // KP: 로그인 → 새 룸 → 세션 시작 전 상태
  const kp = await (await ctx()).newPage();
  await login(kp, "하늘");
  await kp.getByLabel("새 룸 이름").fill(ROOM);
  await kp.getByRole("button", { name: "새 룸 만들기" }).click();
  await kp.waitForURL(/\/room\//);
  const roomUrl = kp.url();
  await kp.getByTestId("connection").getByText("연결됨").waitFor();
  await kp.getByText("세션 시작 전이에요").waitFor();
  step("KP가 룸을 만들고 입장 (세션 시작 전)");

  // 초대 링크 받기
  await kp.getByRole("button", { name: "초대", exact: true }).click();
  const inviteLink = await kp.getByLabel("초대 링크 주소").inputValue();
  assert.match(inviteLink, /\/join\/.+\?invite=/);
  await kp.keyboard.press("Escape");
  assert.equal(await kp.getByRole("dialog").count(), 0);
  // 창을 다시 열어도 링크가 그대로여야 먼저 보낸 링크가 죽지 않는다
  await kp.getByRole("button", { name: "초대", exact: true }).click();
  assert.equal(await kp.getByLabel("초대 링크 주소").inputValue(), inviteLink);
  await kp.keyboard.press("Escape");
  step("KP가 초대 링크를 만듦(다시 열어도 같은 링크)");

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
  assert.equal(await kp.getByRole("dialog").count(), 0);
  step("KP가 디스코드 웹훅을 연결함(주소는 다시 보여 주지 않음)");

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
  await pl.getByText("KP가 세션을 시작하기를 기다리고").waitFor();
  step("PL이 초대 링크로 입장, KP 화면에 보임");

  // 세션 시작 전에는 PL이 굴릴 수 없고, KP가 시작하면 열림
  assert.equal(await pl.getByLabel("굴림 식").isDisabled(), true);
  await kp.getByRole("button", { name: "세션 시작" }).click();
  await pl.getByTestId("session-status").getByText("진행 중").waitFor();
  assert.equal(await pl.getByLabel("굴림 식").isDisabled(), false);
  step("KP가 세션을 시작하면 PL 입력이 열림");

  // 로비 목록에 룸이 보임
  const lobby = await (await ctx()).newPage();
  await login(lobby, "서하");
  await lobby.getByTestId("room-card").getByText(ROOM).waitFor();
  step("PL 로비에 참가한 룸이 보임");

  // 보관함: 캐릭터 만들기
  await lobby.getByRole("link", { name: "내 캐릭터" }).click();
  await lobby.getByRole("button", { name: "새 캐릭터" }).click();
  await lobby.getByLabel("이름", { exact: true }).fill(CHAR);
  await lobby.getByLabel("직업").fill("기자");
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
  await lobby.getByLabel("직업").fill("학생");
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
  lobby.once("dialog", (d) => d.accept());
  await wizCard.getByRole("button", { name: "삭제" }).click();
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
  await lobby.getByRole("button", { name: "교육 향상 판정" }).click();
  await lobby.getByTestId("edu-result").waitFor();
  await lobby.getByRole("button", { name: "다음" }).click();
  assert.equal(await lobby.getByLabel("설득 직업 포인트").isDisabled(), true);
  await lobby.getByLabel("법률 직업 포인트").fill("10");
  await lobby.getByRole("alert").filter({ hasText: "신용도은(는)" }).waitFor();
  assert.equal(await lobby.getByRole("button", { name: "다음" }).isDisabled(), true);
  await lobby.getByLabel("신용도 직업 포인트").fill("25");
  await lobby.getByRole("button", { name: "다음" }).click();
  await lobby.getByRole("button", { name: "캐릭터 만들기" }).click();
  const wizCard2 = lobby.getByTestId("vault-card").filter({ hasText: WIZ2 });
  await wizCard2.waitFor();
  lobby.once("dialog", (d) => d.accept());
  await wizCard2.getByRole("button", { name: "삭제" }).click();
  await wizCard2.waitFor({ state: "detached" });
  // 고치기·내보내기·가져오기
  await lobby.getByRole("button", { name: `${JOB} 직업 수정` }).click();
  assert.equal(await lobby.getByLabel("직업 이름").inputValue(), JOB);
  await lobby.getByLabel("신용도 최대").fill("45");
  await lobby.getByRole("button", { name: "수정 저장" }).click();
  await lobby.getByTestId("occupation-item").filter({ hasText: JOB }).filter({ hasText: "20~45" }).waitFor();
  const [jobDl] = await Promise.all([lobby.waitForEvent("download"), lobby.getByRole("button", { name: "내보내기" }).click()]);
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
  await lobby.context().close();
  step("PL이 보관함에 캐릭터를 만듦 (파생 수치 미리보기 포함)");

  // 룸에서 불러오기 → HP 조절 → 시트로 굴리기
  await pl.getByRole("tab", { name: "시트" }).click();
  await pl.getByTestId("vault-item").filter({ hasText: CHAR }).getByRole("button", { name: "불러오기" }).click();
  await pl.getByTestId("stat-hp").getByText("10/10").waitFor();
  step("PL이 보관함 캐릭터를 룸으로 불러옴");

  await pl.getByRole("button", { name: "HP 감소" }).click();
  await pl.getByTestId("stat-hp").getByText("9/10").waitFor();
  await kp.getByRole("tab", { name: "시트" }).click();
  await kp.getByTestId("stat-hp").getByText("9/10").waitFor();
  step("PL의 HP 변경이 KP 시트에도 반영됨");

  await pl.getByRole("button", { name: "도서관 이용 굴리기" }).click();
  await kp.getByRole("tab", { name: "굴림" }).click();
  await kp.getByTestId("roll-entry").getByText(`${CHAR} · 도서관 이용`).waitFor();
  assert.equal(await pl.getByTestId("roll-entry").first().getByText(`${CHAR} · 도서관 이용`).count(), 1);
  step("시트로 굴린 결과가 라벨과 함께 로그에 남음");

  // SAN 체크: 손실을 2/2로 고정해 결과가 무작위여도 SAN이 정확히 2 줄어든다
  await pl.getByRole("tab", { name: "시트" }).click();
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
  await pl.getByRole("tab", { name: "시트" }).click();
  await pl.getByTestId("stat-san").getByText(new RegExp(`^${sanBefore - 2}/`)).waitFor();
  await pl.getByTestId("san-day").getByText("오늘 손실 2").waitFor();
  await pl.getByRole("tab", { name: "굴림" }).click();
  step("SAN 체크가 로그에 남고 SAN과 오늘 손실이 갱신됨");
  // SAN 효과: 5 이상 잃으면 절제된 화면 효과가 나오고, 내가 효과를 끄면 나오지 않는다
  await pl.getByRole("tab", { name: "시트" }).click();
  await pl.getByLabel("SAN 손실").fill("6/6");
  await pl.getByRole("button", { name: "SAN 체크", exact: true }).click();
  await pl.getByRole("button", { name: "SAN 체크 굴리기" }).click();
  await pl.getByTestId("san-effect").waitFor();
  await pl.getByTestId("san-effect").waitFor({ state: "detached", timeout: 6000 });
  await pl.getByRole("tab", { name: "굴림" }).click();
  step("SAN 큰 손실에는 화면 가장자리가 어두워지는 효과가 나왔다 사라짐");

  // 푸시와 행운: 서버 주사위라 결과를 정할 수 없으니 실패가 나올 때까지 시트 판정을 굴린다
  const rollSkill = async () => {
    const entries = pl.getByTestId("roll-entry");
    const before = await entries.count();
    await pl.getByRole("tab", { name: "시트" }).click();
    await pl.getByRole("button", { name: "도서관 이용 굴리기" }).click();
    await pl.getByRole("tab", { name: "굴림" }).click();
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
    await pl.getByRole("tab", { name: "시트" }).click();
    await pl.getByRole("button", { name: "맨손 격투 굴리기" }).click();
    await pl.getByRole("tab", { name: "굴림" }).click();
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

  // 광기: KP가 상태를 지정하면 PL 시트에 표시, 증상표에서 굴리면 주인과 KP만 본다
  await openSettings(kp);
  await kp.getByRole("button", { name: "광기표", exact: true }).click();
  await kp.getByLabel("증상 목록").fill("공포에 얼어붙는다\n비명을 지르며 달아난다");
  await kp.getByRole("button", { name: "저장", exact: true }).click();
  await kp.keyboard.press("Escape");
  await kp.getByRole("tab", { name: "시트" }).click();
  await kp.getByLabel("광기 상태").selectOption("temporary");
  await pl.getByRole("tab", { name: "시트" }).click();
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
  await pl.getByRole("tab", { name: "굴림" }).click();
  await kp.getByRole("tab", { name: "굴림" }).click();
  step("광기 상태 표시, 증상 굴림은 주인과 KP에게만, 해제하면 사라짐");

  // 판정 요청: KP가 요청하면 PL 화면에 배너가 뜨고, 누르면 내 캐릭터로 굴려짐
  await openAsk(kp);
  await kp.getByLabel("요청할 기능").fill("도서관 이용");
  await kp.getByRole("button", { name: "요청 보내기" }).click();
  const askBanner = pl.getByTestId("roll-ask-banner");
  await askBanner.getByText("도서관 이용").waitFor();
  await askBanner.getByRole("button", { name: "굴리기" }).click();
  await askBanner.waitFor({ state: "detached" });
  await pl.getByTestId("roll-entry").getByText(`${CHAR} · 도서관 이용`).first().waitFor();
  step("KP가 판정을 요청하면 PL에게 배너가 뜨고, 굴리기를 누르면 내 캐릭터로 굴림");

  // 탭 목록은 화살표 키로 옮길 수 있다
  await pl.getByRole("tab", { name: "굴림" }).focus();
  await pl.keyboard.press("ArrowRight");
  await pl.getByRole("tab", { name: "시트", selected: true }).waitFor();
  await pl.keyboard.press("ArrowLeft");
  await pl.getByRole("tab", { name: "굴림", selected: true }).waitFor();
  step("탭 목록이 화살표 키로 움직임");

  // 무기·상태·소지품
  await pl.getByRole("tab", { name: "시트" }).click();
  await pl.getByTestId("weapons").getByText("주먹").waitFor();
  await pl.getByRole("button", { name: "주먹 피해" }).click();
  await pl.getByTestId("roll-entry").getByText(`${CHAR} · 주먹 피해`).first().waitFor();
  await pl.getByRole("tab", { name: "시트" }).click();
  await pl.getByTestId("conditions").getByRole("button", { name: "중상" }).click();
  await kp.getByRole("tab", { name: "시트" }).click();
  await kp.getByTestId("conditions").getByRole("button", { name: "중상", pressed: true }).waitFor();
  assert.equal(await kp.getByLabel("소지품").inputValue(), "손전등");
  await pl.getByTestId("conditions").getByRole("button", { name: "중상" }).click();
  await kp.getByTestId("conditions").getByRole("button", { name: "중상", pressed: false }).waitFor();
  await pl.getByRole("tab", { name: "굴림" }).click();
  await kp.getByRole("tab", { name: "굴림" }).click();
  step("무기 피해 굴림이 로그에 남고, 중상 상태와 소지품이 KP 시트에 반영됨");

  // 핸드아웃: 초안 → 특정 PL에게 공개 → 다시 초안
  await kp.getByRole("tab", { name: "핸드아웃" }).click();
  await kp.getByRole("button", { name: "새 핸드아웃" }).click();
  await kp.getByLabel("핸드아웃 제목").fill("낡은 편지");
  await kp.getByLabel("핸드아웃 내용").fill("자정에 서재로 와 주게.");
  await kp.getByLabel("공개 범위").selectOption("pick");
  await kp.getByLabel("서하", { exact: true }).check();
  await kp.getByRole("button", { name: "저장", exact: true }).click();
  await kp.getByTestId("handout-item").getByText("낡은 편지").waitFor();
  await pl.getByTestId("handout-new").waitFor(); // 핸드아웃 탭을 안 보는 PL에게 새 핸드아웃 표시
  await pl.getByRole("tab", { name: "핸드아웃" }).click();
  await pl.getByTestId("handout-new").waitFor({ state: "detached" });
  await pl.getByTestId("handout-item").getByText("낡은 편지").waitFor();
  await pl.getByTestId("handout-item").getByText("낡은 편지").click();
  await pl.getByText("자정에 서재로 와 주게.").waitFor();
  step("KP가 공개한 핸드아웃이 PL에게 나타나고 내용을 읽을 수 있음");

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
  step("KP가 펼쳐 보이면 PL 화면 가운데에 핸드아웃이 뜨고 닫을 수 있음");

  await kp.getByRole("button", { name: "편집" }).click();
  await kp.getByLabel("공개 범위").selectOption("gm");
  await kp.getByRole("button", { name: "저장", exact: true }).click();
  await pl.getByTestId("handout-item").waitFor({ state: "detached" });
  step("초안으로 되돌리면 PL 화면에서 사라짐");
  await kp.getByRole("tab", { name: "굴림" }).click();
  await pl.getByRole("tab", { name: "굴림" }).click();


  // KP가 토큰을 만들고 PL이 받음
  await kp.getByRole("button", { name: "+ 토큰" }).click();
  await pl.getByTestId("obj-서하").waitFor();
  step("KP가 만든 토큰이 PL 화면에 나타남");

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
  await kp.getByRole("tab", { name: "핸드아웃" }).click();
  await kp.getByRole("button", { name: "새 핸드아웃" }).click();
  await kp.getByLabel("핸드아웃 제목").fill("사진 한 장");
  await kp.getByLabel("이미지 넣기 파일").setInputFiles(file);
  await kp.getByAltText("핸드아웃 이미지 미리보기").waitFor();
  await kp.getByLabel("공개 범위").selectOption("all");
  await kp.getByRole("button", { name: "저장", exact: true }).click();
  await pl.getByRole("tab", { name: "핸드아웃" }).click();
  await pl.getByTestId("handout-item").getByText("사진 한 장").click();
  await pl.getByAltText("사진 한 장 이미지").waitFor();
  await kp.getByTestId("handout-item").getByRole("button", { name: "삭제" }).first().waitFor();
  kp.once("dialog", (d) => d.accept());
  await kp.getByTestId("handout-item").filter({ hasText: "사진 한 장" }).getByRole("button", { name: "삭제" }).click();
  await pl.getByTestId("handout-item").waitFor({ state: "detached" });
  await kp.getByRole("tab", { name: "굴림" }).click();
  await pl.getByRole("tab", { name: "굴림" }).click();
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
  step("PL이 끈 토큰이 KP 화면에서 움직임");

  // 핑: PL이 Alt+클릭하면 KP 화면에 파동과 이름표가 잠시 뜬다(PL 화면에도 보인다)
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
  step("PL이 Alt+클릭으로 가리키면 KP 화면에 이름표 달린 핑이 잠시 뜨고 사라짐");

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

  // GM 전용 오브젝트는 PL에게 안 보임
  await kp.getByRole("button", { name: "+ GM 전용" }).click();
  await kp.getByTestId("obj-숨김 소품2").waitFor();
  await pl.waitForTimeout(400);
  assert.equal(await pl.getByTestId("obj-숨김 소품2").count(), 0);
  step("GM 전용 오브젝트는 PL 화면에 없음");

  // 시트→토큰: KP가 시트 탭에서 "토큰으로 놓기"를 누르면 그 캐릭터 이름·소유자로 토큰이 생긴다
  await kp.getByRole("tab", { name: "시트" }).click();
  await kp.getByRole("button", { name: "토큰으로 놓기" }).click();
  await pl.getByTestId(`obj-${CHAR}`).waitFor();
  assert.equal(await pl.getByTestId(`obj-${CHAR}`).getAttribute("data-mine"), "true");
  await kp.getByRole("tab", { name: "굴림" }).click();
  step("시트 탭의 '토큰으로 놓기'로 캐릭터 이름·소유자 토큰이 생기고 그 PL 화면에서 '나'로 표시됨");

  // 안개와 시야: 안개 속 오브젝트는 PL 화면에서 아예 사라지고, 시야·밝힌 영역으로 다시 보임
  await kp.getByRole("button", { name: "+ 소품" }).click();
  const plProps = pl.locator('[data-testid^="obj-소품"]');
  await plProps.first().waitFor();
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
  // 탐험 기록: 시야가 지나간 자리는 지금 안 보여도 기록으로 남고, KP가 지울 수 있다
  await pl.getByTestId("fog-explored").waitFor();
  await kp.getByTestId("fog-explored-count").getByText(/탐험 기록 [1-9]/).waitFor();
  await kp.getByRole("button", { name: "탐험 기록 지우기" }).click();
  await kp.getByTestId("fog-explored-count").getByText("탐험 기록 0").waitFor();
  await pl.getByTestId("fog-explored").waitFor({ state: "detached" });
  await plProps.first().waitFor({ state: "detached" });
  await kp.getByRole("button", { name: "안개 끄기" }).click();
  await plProps.first().waitFor();
  await pl.getByTestId("fog").waitFor({ state: "detached" });
  step("안개와 시야: 안개 속 오브젝트는 PL 화면에서 사라지고, 시야 반지름·밝힌 영역으로 다시 보이며, 지나간 자리는 탐험 기록으로 남고(KP가 지움), 끄면 모두 보임");

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
  step("되돌리기: KP 토큰 삭제 뒤 Ctrl+Z 로 복귀하고, 이동도 Ctrl+Z 로 원위치");

  // 보드 단축키·오른쪽 클릭 메뉴: Backspace 삭제 + Ctrl+Z, Ctrl+D 복제, Esc 선택 해제, Tab 이동, 메뉴 항목
  {
    const sel = kp.getByTestId("selected-bar");
    const selName = () => sel.getByLabel("선택한 오브젝트 이름").inputValue();
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
    assert.equal(await kp.getByTestId("board-hint").count(), 0); // 배경이 생기면 안내는 사라진다
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
    await kp.getByRole("tab", { name: "핸드아웃" }).click();
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
    await kp.getByRole("tab", { name: "굴림" }).click();
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
  step("PL의 굴림이 KP 로그에 보임");

  // 굴림: KP 비밀 굴림
  await kp.getByLabel(/비밀 굴림/).check();
  await kp.getByLabel("굴림 식").fill("1d100");
  await kp.getByRole("button", { name: "굴리기" }).click();
  await pl.getByTestId("roll-hidden").waitFor();
  assert.ok((await pl.getByTestId("roll-entry").count()) >= 3); // 시트 굴림 + SAN 체크 + CC 굴림(+ 푸시·행운 시도)
  assert.ok((await kp.getByTestId("roll-entry").count()) >= 4);
  step("KP 비밀 굴림: PL은 '했다'는 사실만 봄");

  // KP 접속 끊김 → 유예(배너, 입력은 계속 열림) → 유예 뒤 자동 정지 → KP가 돌아오면 자동 재개
  // (API는 KP_AWAY_GRACE_MS로 유예를 줄여 띄운다. 기본은 30초.)
  await kp.context().close();
  await pl.getByTestId("kp-away-banner").getByText("KP 연결이 끊겼어요. 잠시 기다려요.").waitFor();
  assert.equal(await pl.getByLabel("굴림 식").isDisabled(), false);
  assert.equal(await pl.getByTestId("session-status").getByText("진행 중").count(), 1);
  step("KP 연결이 끊기면 PL 화면에 '잠시 기다려요' 배너가 뜨고 아직 정지는 아님");
  await pl.getByText("세션이 일시정지 중이에요").first().waitFor();
  assert.equal(await pl.getByLabel("굴림 식").isDisabled(), true);
  assert.equal(await pl.getByTestId("kp-away-banner").count(), 0);
  step("유예가 지나도 KP가 안 오면 PL 화면이 일시정지로 바뀌고 입력이 막힘");

  const kp2 = await (await ctx()).newPage();
  await login(kp2, "하늘");
  await kp2.goto(roomUrl);
  await pl.getByTestId("session-status").getByText("진행 중").waitFor();
  assert.equal(await pl.getByLabel("굴림 식").isDisabled(), false);
  assert.equal(await kp2.getByRole("button", { name: "이어하기" }).count(), 0);
  step("KP가 돌아오면 이어하기 없이 자동 재개되어 PL 입력이 다시 열림");

  // KP가 직접 누른 일시정지: 정지 중에도 KP는 토큰을 놓을 수 있고(굴림은 막힘), 새로고침해도 자동 재개되지 않음
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
  step("KP가 직접 멈추면 정지 중에도 토큰 편집은 되고 굴림은 막히며, 새로고침해도 자동 재개되지 않고 이어하기로 풀림");

  // 새로고침(유예 안의 재접속): PL은 정지를 보지 않는다
  await kp2.reload();
  await kp2.getByTestId("connection").getByText("연결됨").waitFor();
  await kp2.waitForTimeout(500);
  assert.equal(await pl.getByText("세션이 일시정지 중이에요").count(), 0);
  assert.equal(await pl.getByTestId("session-status").getByText("진행 중").count(), 1);
  step("KP가 새로고침해도 유예 안에 돌아오면 PL 화면은 정지되지 않음");

  // 판정 효과: KP가 "어려운 성공"까지 켜면 PL 화면에 효과가 재생되고, PL이 개인 설정으로 끌 수 있음
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
  await pl.getByRole("button", { name: /^효과 켜짐/ }).click();
  await pl.keyboard.press("Escape");
  await pl.getByTestId("roll-effect").waitFor({ state: "detached", timeout: 4000 }).catch(() => {});
  for (let i = 0; i < 25; i++) {
    await rollOnce();
    assert.equal(await pl.getByTestId("roll-effect").count(), 0, "끈 뒤에도 효과가 재생됨");
  }
  step("PL이 효과를 끄면 더는 재생되지 않음");

  // 장면: KP가 다른 장면을 미리 꾸미면 PL에게는 안 보이고, 페이드 전환하면 PL 화면이 통째로 바뀜
  await kp2.getByLabel("새 장면 이름").fill("서재");
  await kp2.getByRole("button", { name: "추가", exact: true }).click();
  await kp2.getByRole("tab", { name: "서재" }).click();
  await kp2.getByRole("button", { name: "+ 소품" }).click();
  await kp2.getByTestId("obj-소품1").waitFor();
  await pl.waitForTimeout(400);
  assert.equal(await pl.getByTestId("obj-소품1").count(), 0);
  step("KP가 준비 중인 다른 장면의 오브젝트는 PL에게 보이지 않음");

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
    await kp2.getByLabel("새 장면 이름").fill(scene);
    await kp2.getByRole("button", { name: "추가", exact: true }).click();
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

  await kp2.getByRole("button", { name: "슬롯 1: 비어 있음" }).click();
  await kp2.getByLabel("명령어 검색어").fill("서재 페이드");
  await kp2.keyboard.press("Enter");
  await kp2.getByRole("button", { name: /^슬롯 1: 장면 전환 · 서재/ }).waitFor();
  await kp2.locator(".board").click({ position: { x: 20, y: 400 } });
  await kp2.keyboard.press("1");
  await pl.getByTestId("scene-name").getByText("서재").waitFor();
  step("슬롯 1에 등록한 장면 전환이 숫자 키 1로 실행됨");

  // 전투 순서: KP가 시작하고 NPC를 넣고 넘기면 PL 화면에 같은 순서와 차례가 보임
  // 활성 장면(서재)에 서하 소유 토큰을 놓아 둔다: 차례 링과 이동 안내를 보려는 것
  await kp2.getByLabel("새 토큰 이름").fill("전투서하");
  await kp2.getByRole("button", { name: "+ 토큰" }).click();
  await pl.getByTestId("obj-전투서하").waitFor();
  await kp2.getByRole("tab", { name: /^전투/ }).click();
  await kp2.getByRole("button", { name: "전투 시작" }).click();
  await pl.getByTestId("my-turn").waitFor();
  await pl.getByTestId("obj-전투서하").getByTestId("turn-ring").waitFor();
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
  step("KP의 '이동 잠금/이동 풀기'로 PL 토큰이 한꺼번에 잠기고 풀림");
  await kp2.getByRole("tab", { name: "굴림" }).click();
  await pl.getByRole("tab", { name: "굴림" }).click();

  // 세션 흐름: 비트와 분기를 짜 두면 조건이 맞을 때 KP에게만 제안하고, 엔딩을 확정하면 종료 창이 채워짐
  await kp2.getByRole("tab", { name: /^흐름/ }).click();
  assert.equal(await pl.getByRole("tab", { name: /^흐름/ }).count(), 0);
  await kp2.getByRole("button", { name: "비트 추가" }).click();
  await kp2.getByLabel("비트 이름").fill("단서 발견");
  await kp2.getByLabel("KP 메모").fill("비밀 메모 " + run);
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
  step("세션 흐름: 비트·분기를 짜면 조건이 맞을 때 KP에게만 제안하고, 엔딩 확정 뒤 종료 창이 엔딩 이름으로 채워짐");
  await kp2.getByRole("tab", { name: "굴림" }).click();

  // 세션 종료 → 보관함에 반영
  await kp2.getByRole("button", { name: "세션 종료" }).click();
  await kp2.getByLabel("엔딩 이름 (선택)").fill("새벽의 생존자");
  await kp2.getByRole("button", { name: "정산하고 종료" }).click();
  await pl.getByTestId("session-status").getByText("대기").waitFor();
  await pl.getByRole("dialog", { name: "세션 정산" }).getByText("엔딩 · 새벽의 생존자").waitFor();
  await pl.keyboard.press("Escape");
  assert.equal(await pl.getByRole("dialog", { name: "세션 정산" }).count(), 0);
  step("세션 종료 때 엔딩 이름이 모두에게 보이고 닫을 수 있음");
  await pl.getByRole("tab", { name: "시트" }).click();
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
  await pl.getByRole("tab", { name: "굴림" }).click();
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
  await pl.getByRole("tab", { name: "굴림" }).click();
  const [dl] = await Promise.all([pl.waitForEvent("download"), pl.getByRole("button", { name: "굴림 기록 저장" }).click()]);
  assert.match(dl.suggestedFilename(), /^roll-log-\d{8}\.md$/);
  const saved = await (await import("node:fs/promises")).readFile(await dl.path(), "utf8");
  assert.ok(saved.startsWith("# 굴림 기록"));
  assert.ok(saved.includes("볼 수 있었던 굴림만"));
  assert.ok(saved.includes("## 세션"));
  step("굴림 기록을 마크다운 파일로 저장함(PL에게는 비밀 굴림이 빠졌다는 안내가 붙음)");

  // 음향: KP가 올린 배경음이 모두에게 흐르고(DOM 상태만 확인), 비트 큐에 묶으면 비트에 들어갈 때 바뀜
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
  step("음향: KP가 올린 배경음을 재생·정지하고, PL은 음향 탭 없이 내 소리 설정만 만짐");

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
  kp2.once("dialog", (d) => d.accept());
  await track.getByRole("button", { name: /삭제$/ }).click();
  await track.waitFor({ state: "detached" });
  step("음향: 비트 큐에 묶은 배경음이 비트에 들어가면 흐르고, 음원을 지우면 목록에서 사라짐");

  // KP 전용 노트: PL에게 안 보이고, 펼쳐 보이기 버튼도 없다
  await kp2.getByRole("tab", { name: "핸드아웃" }).click();
  await kp2.getByRole("button", { name: "새 핸드아웃" }).click();
  await kp2.getByLabel("핸드아웃 제목").fill("진상 " + run);
  await kp2.getByLabel("핸드아웃 내용").fill("범인은 이웃");
  await kp2.getByLabel("공개 범위").selectOption("note");
  await kp2.getByRole("button", { name: "저장", exact: true }).click();
  const note = kp2.getByTestId("handout-item").filter({ hasText: "진상 " + run });
  await note.getByText("KP 노트").waitFor();
  assert.equal(await note.getByRole("button", { name: "펼쳐 보이기" }).count(), 0);
  await pl.getByRole("tab", { name: "핸드아웃" }).click();
  await pl.waitForTimeout(400);
  assert.equal(await pl.getByText("진상 " + run).count(), 0);
  step("KP 전용 노트는 PL에게 보이지 않고 펼쳐 보일 수도 없음");

  // 토큰 소유자: PL 3명이 각자 자기 토큰만 움직이고, KP가 이름·소유자를 바꾼다
  {
    const SHOT = "/tmp/shots-token";
    const kpT = await (await ctx()).newPage();
    await login(kpT, "하늘" + run);
    await kpT.getByLabel("새 룸 이름").fill("토큰방 " + run);
    await kpT.getByRole("button", { name: "새 룸 만들기" }).click();
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

    // KP가 이름·소유자를 바꾼다: 도윤 토큰을 NPC로 풀고 이름 변경 → 도윤은 못 움직임
    await kpT.getByTestId(`obj-${names[1]}`).click();
    await kpT.getByLabel("선택한 오브젝트 이름").fill("문지기 " + run);
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
    step("KP가 토큰 이름을 바꾸고 소유자를 NPC로 풀거나 다른 PL에게 넘기고, 잠그면 소유자도 못 움직임");

    // 시트→토큰: KP가 시트 패널에서 토큰으로 놓기
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
    for (let i = 0; i < 3; i++) await pl.keyboard.press("ArrowRight");
    await pl.waitForFunction(([t, x]) => Number(document.querySelector(`[data-testid="${t}"]`)?.getAttribute("data-x")) === x, [tid, x0 + 30]);
    await kp2.waitForFunction(([t, x]) => Number(document.querySelector(`[data-testid="${t}"]`)?.getAttribute("data-x")) === x, [tid, x0 + 30]);
    const vb = async (page) => (await page.getByTestId("board").getAttribute("viewBox")).split(" ").map(Number);
    assert.equal((await vb(pl))[2], 1000);
    await pl.getByRole("button", { name: "확대" }).click();
    assert.ok((await vb(pl))[2] < 1000);
    await pl.getByTestId("focus-mine").click();
    await pl.getByRole("button", { name: "전체" }).click();
    assert.equal((await vb(pl))[2], 1000);
    step("보드: 방향키로 내 토큰이 움직여 KP에게도 보이고, 확대·내 토큰 보기·전체 보기가 동작함");
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
  if (process.env.E2E_DEBUG) console.error(e.stack); // 어느 줄에서 멈췄는지 보고 싶을 때
  process.exitCode = 1;
} finally {
  await browser.close();
}
