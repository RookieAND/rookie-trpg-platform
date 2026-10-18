// 쓰이지 않는 이미지·오디오 정리. 사용법: pnpm cleanup:images [--dry-run] [--days 7] [--max-delete 500]
// 서버와 같은 환경변수(DATABASE_URL, DATA_DIR, S3_*)를 읽어 같은 저장소에 연결한다.
import "reflect-metadata";
import { ConfigError, loadConfig } from "../src/config";
import { cleanupUnusedImages } from "../src/maintenance/cleanup-images";
import { buildStores } from "../src/platform/wiring";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const num = (n: string, d?: number) => {
  const i = args.indexOf(n);
  if (i < 0) return d;
  const v = Number(args[i + 1]);
  if (!Number.isFinite(v) || v < 0) {
    console.error(`${n} 값이 올바르지 않아요.`);
    process.exit(2);
  }
  return v;
};

if (flag("--help") || flag("-h")) {
  console.log("pnpm cleanup:images [--dry-run] [--days 7] [--max-delete N]\n  --dry-run     지우지 않고 목록만 보여 줘요\n  --days N      올린 지 N일이 안 된 파일은 건드리지 않아요 (기본 7)\n  --max-delete  지울 파일이 이보다 많으면 아무것도 안 지우고 멈춰요");
  process.exit(0);
}

try {
  const config = loadConfig();
  const stores = await buildStores(config, { migrate: false });
  console.log(`룸: ${stores.describe.rooms} / 파일: ${stores.describe.images}${flag("--dry-run") ? " (dry-run)" : ""}`);
  const r = await cleanupUnusedImages({
    store: stores.store,
    images: stores.images,
    minAgeDays: num("--days", 7)!,
    dryRun: flag("--dry-run"),
    maxDelete: num("--max-delete"),
    log: (l) => console.log(l),
  });
  console.log(`룸 ${r.rooms}개가 가리키는 파일 ${r.referenced}개 / 저장된 파일 ${r.scanned}개 / 너무 최근이라 남김 ${r.tooNew}개`);
  console.log(`쓰이지 않는 파일 ${r.unused.length}개${flag("--dry-run") ? " (dry-run이라 지우지 않았어요)" : `, 지움 ${r.deleted}개, 실패 ${r.failed}개`}`);
  if (flag("--dry-run") && r.unused.length) console.log(r.unused.slice(0, 50).join("\n") + (r.unused.length > 50 ? `\n… 외 ${r.unused.length - 50}개` : ""));
  await stores.db?.close();
  process.exit(r.aborted ? 3 : r.failed ? 1 : 0);
} catch (e) {
  console.error(e instanceof ConfigError ? `설정 오류: ${e.message}` : `정리하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
