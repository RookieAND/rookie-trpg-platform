// 오류 화면(error boundary)과 없는 주소 안내를 실제 브라우저로 확인한다. 흰 화면이 되지 않는지가 핵심.
// 사전 조건: API와 웹이 떠 있어야 한다(WEB_URL, API_URL). `pnpm --filter @coc-vtt/web e2e:errors`
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const exe = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--no-proxy-server", "--disable-dev-shm-usage"] });
const step = (m) => console.log("✓", m);
const run = Date.now().toString(36);

try {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 760 } })).newPage();
  page.setDefaultTimeout(Number(process.env.E2E_TIMEOUT_MS ?? 30000));

  // 1) 없는 주소와 이상한 룸 id
  const nf = await page.goto(`${WEB}/no-such-page-${run}`);
  assert.equal(nf?.status(), 404);
  await page.getByTestId("error-panel").getByText("찾을 수 없어요").waitFor();
  await page.getByTestId("error-home").click();
  await page.waitForURL(`${WEB}/`);
  step("없는 주소는 안내와 로비로 버튼이 있는 404");

  const bad = await page.goto(`${WEB}/room/bad%20id`);
  assert.equal(bad?.status(), 404);
  await page.getByText("룸을 찾을 수 없어요").first().waitFor();
  step("룸 id 모양이 아니면 바로 룸 없음 안내");

  // 2) 로그인하고 룸을 만든 뒤, 서버가 깨진 메시지를 보낸 것처럼 꾸며 룸 화면 렌더가 던지게 한다.
  await page.goto(WEB);
  await page.getByLabel("이름").fill(`오류확인${run}`);
  await page.getByRole("button", { name: "시작하기" }).click();
  await page.getByLabel("새 룸 이름").fill(`오류 룸 ${run}`);
  await page.getByRole("button", { name: "새 룸 만들기", exact: true }).click();
  await page.waitForURL(/\/room\//);
  await page.getByTestId("connection").getByText("연결됨").waitFor();
  const roomUrl = page.url();
  step("룸이 정상으로 열림");

  let poison = false;
  let opened = 0;
  let closedAfterError = 0;
  await page.routeWebSocket(/\/ws\?/, (ws) => {
    opened += 1;
    const server = ws.connectToServer();
    server.onMessage((m) => {
      if (poison && typeof m === "string" && m.includes('"type":"snapshot"')) {
        // 화면이 읽는 필드를 통째로 망가뜨린 snapshot
        ws.send(JSON.stringify({ seq: 0, event: { type: "snapshot", data: { roomId: "x", members: null, objects: null, scenes: null } } }));
        return;
      }
      ws.send(m);
    });
    ws.onMessage((m) => server.send(m));
    ws.onClose(() => {
      if (poison) closedAfterError += 1;
    });
  });
  poison = true;
  await page.goto(roomUrl);
  const panel = page.getByTestId("error-panel");
  await panel.waitFor();
  await panel.getByText("룸 화면에 문제가 생겼어요").waitFor();
  assert.ok((await page.locator("body").innerText()).trim().length > 10, "흰 화면이면 안 돼요");
  await page.getByTestId("error-retry").waitFor();
  await page.getByTestId("error-home").waitFor();
  step("룸 화면이 던지면 안내 + 다시 시도 + 로비로");

  // 룸 화면이 사라질 때 접속도 닫혀야 한다(반쯤 깨진 화면이 연결을 붙들지 않게).
  await page.waitForTimeout(500);
  assert.ok(closedAfterError >= 1, "룸 화면이 사라질 때 ws도 닫혀야 해요");
  step("오류 화면이 뜨면 접속도 정리됨");

  // 3) 서버가 정상으로 돌아오면 '다시 시도'로 룸이 다시 열린다.
  poison = false;
  await page.getByTestId("error-retry").click();
  await page.getByTestId("connection").getByText("연결됨").waitFor();
  await panel.waitFor({ state: "detached" });
  step("다시 시도하면 룸을 처음부터 불러와 다시 접속");

  // 4) 로비로 돌아갈 수 있다
  poison = true;
  await page.reload();
  await panel.waitFor();
  await page.getByTestId("error-home").click();
  await page.waitForURL(`${WEB}/`);
  await page.getByText("내 룸").waitFor();
  step("로비로 버튼으로 빠져나옴");
  console.log("\n오류 화면 e2e 통과");
} finally {
  await browser.close();
}
