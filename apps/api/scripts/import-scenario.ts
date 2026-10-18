/**
 * 시나리오 파일(JSON)로 새 룸을 만든다. 웹의 "시나리오 가져오기"와 같은 서버 경로(POST /rooms/import)를 쓰므로
 * 검증·한도·저장 방식이 같다. 형식은 docs/scenario-format.md 를 본다.
 * 내 컴퓨터의 이미지·오디오 파일은 보내기 전에 읽어 형식·크기를 확인하고 데이터 주소로 바꿔 올린다.
 * 문제가 있으면 룸이 만들어지지 않는다.
 *
 * 사용법(서버가 켜져 있어야 한다):
 *   pnpm import:scenario <시나리오.json> [--user 이름 | --token 로그인토큰] [--api http://localhost:8787] [--room 룸이름]
 *
 * 개발용 로그인(--user)에서는 이름이 곧 신원이다. 실제 로그인을 쓰는 서버에서는 --token(Bearer)을 쓴다.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { countScenario, countsLine, josa, parseScenarioText } from "@coc-vtt/shared";
import { inlineLocalFiles } from "./scenario-local";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) opt[a.slice(2)] = argv[++i] ?? "";
    else positional.push(a);
  }
  return { file: positional[0], user: opt.user ?? "RookieAND", token: opt.token, api: opt.api ?? "http://localhost:8787", room: opt.room };
}

async function main() {
  const { file, user, token, api, room } = parseArgs(process.argv.slice(2));
  if (!file) throw new Error("사용법: pnpm import:scenario <시나리오.json> [--user 이름 | --token 토큰] [--api 주소] [--room 룸이름]");
  const parsed = parseScenarioText(readFileSync(file, "utf8"));
  if (!parsed.ok) throw new Error(`시나리오 파일에 문제가 있어서 룸을 만들지 않았어요.\n${parsed.errors.map((e) => `  - ${e.where}: ${e.message}`).join("\n")}`);

  const baseDir = dirname(resolve(file));
  const local = inlineLocalFiles(parsed.doc, (rel) => {
    const abs = resolve(baseDir, rel);
    return existsSync(abs) && statSync(abs).isFile() ? readFileSync(abs) : null;
  });
  if (local.errors.length > 0) throw new Error(`시나리오 파일에 문제가 있어서 룸을 만들지 않았어요.\n${local.errors.map((p) => `  - ${p}`).join("\n")}`);

  const enc = encodeURIComponent;
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : { "x-dev-user": enc(user.trim().toLowerCase().replace(/\s+/g, "-")), "x-dev-name": enc(user) };
  const url = `${api}/rooms/import${room ? `?name=${enc(room)}` : ""}`;
  const res = await fetch(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: JSON.stringify(local.doc) });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text) as { message?: string; errors?: string[] };
      detail = [j.message, ...(j.errors ?? []).map((e) => `  - ${e}`)].filter(Boolean).join("\n");
    } catch {
      /* 글 그대로 */
    }
    throw new Error(`룸을 만들지 못했어요(${res.status}): ${detail}`);
  }
  const created = JSON.parse(text) as { id: string; name: string; invite: { code: string }; warnings: string[] };
  console.log(`룸 ${josa(`"${created.name}"`, "을/를")} 만들었어요.`);
  console.log(`  룸 id: ${created.id}`);
  console.log(`  초대 코드: ${created.invite.code}`);
  console.log(`  ${countsLine(countScenario(local.doc))}`);
  for (const w of created.warnings) console.log(`  주의: ${w}`);
  console.log(`  웹에서 같은 계정으로 로그인하면 내 룸에 보여요: /room/${created.id}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
