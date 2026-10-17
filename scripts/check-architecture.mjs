// 아키텍처 의존 방향을 검사한다.
//  - 프런트(FSD): app → views → widgets → features → entities → shared 로만 import. 같은 층의 다른 슬라이스끼리는 금지(entities 제외).
//  - 백엔드(DDD): domain ← application ← infrastructure/interface. 컨텍스트끼리는 identity만 공유한다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

const root = resolve(import.meta.dirname, "..");
const problems = [];

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });

const importsOf = (file) =>
  [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);

// ── FSD ──
const FSD = ["app", "views", "widgets", "features", "entities", "shared"];
const webSrc = join(root, "apps/web/src");
for (const file of walk(webSrc)) {
  const rel = relative(webSrc, file).split("/");
  const layer = rel[0];
  const slice = rel[1];
  for (const spec of importsOf(file)) {
    let target;
    if (spec.startsWith("@/")) target = spec.slice(2).split("/");
    else if (spec.startsWith(".")) target = relative(webSrc, resolve(dirname(file), spec)).split("/");
    else continue;
    const [tLayer, tSlice, ...tRest] = target;
    if (!FSD.includes(tLayer)) continue;
    const here = FSD.indexOf(layer);
    const there = FSD.indexOf(tLayer);
    if (there < here) problems.push(`${relative(root, file)}: ${layer}이(가) 위 계층 ${tLayer}을(를) 가져와요 (${spec})`);
    else if (there === here && layer !== "shared" && layer !== "app" && tSlice !== slice) {
      problems.push(`${relative(root, file)}: 같은 계층의 다른 슬라이스 ${tSlice}을(를) 가져와요 (${spec})`);
    }
    // 다른 슬라이스는 index(공개 API)로만 접근
    if (there < FSD.length - 1 && tLayer !== "app" && (tSlice !== slice || tLayer !== layer) && tRest.length > 0 && !spec.startsWith(".")) {
      problems.push(`${relative(root, file)}: ${tLayer}/${tSlice}의 내부 파일을 직접 가져와요. index로 가져와 주세요 (${spec})`);
    }
  }
}

// ── DDD ──
const apiSrc = join(root, "apps/api/src");
const LAYERS = ["domain", "application", "infrastructure", "interface"];
const allowed = {
  domain: ["domain"],
  application: ["domain", "application"],
  infrastructure: ["domain", "infrastructure"],
  interface: ["domain", "application", "interface"],
};
for (const file of walk(apiSrc)) {
  const rel = relative(apiSrc, file).split("/");
  const [ctx, layer] = rel;
  if (!LAYERS.includes(layer)) continue;
  for (const spec of importsOf(file)) {
    if (!spec.startsWith(".")) continue;
    const t = relative(apiSrc, resolve(dirname(file), spec)).split("/");
    const [tCtx, tLayer] = t;
    if (!LAYERS.includes(tLayer)) continue;
    if (!allowed[layer].includes(tLayer)) problems.push(`${relative(root, file)}: ${layer}이(가) ${tLayer}을(를) 가져와요 (${spec})`);
    if (tCtx !== ctx && tCtx !== "identity") problems.push(`${relative(root, file)}: 컨텍스트 ${ctx}가 ${tCtx}를 직접 가져와요 (${spec})`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("아키텍처 의존 방향 OK");
