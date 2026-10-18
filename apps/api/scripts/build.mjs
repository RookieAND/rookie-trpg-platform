// API 운영 빌드. src/main.ts(와 워크스페이스 패키지 shared·room-core의 TS 소스)를 dist/main.js 하나로 묶는다.
// 외부 npm 패키지(nest, pg, ws ...)는 묶지 않고 dist/package.json의 dependencies로 남긴다.
// 실행: node dist/main.js  (dist 옆에 node_modules가 있어야 한다. Dockerfile 참고)
import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const external = Object.entries(pkg.dependencies).filter(([, v]) => !String(v).startsWith("workspace:"));

rmSync(resolve(root, "dist"), { recursive: true, force: true });
mkdirSync(resolve(root, "dist"), { recursive: true });

await build({
  entryPoints: { main: resolve(root, "src/main.ts"), "cleanup-images": resolve(root, "scripts/cleanup-images.ts") },
  outdir: resolve(root, "dist"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external: external.map(([name]) => name),
  tsconfig: resolve(root, "tsconfig.json"),
  // ESM 번들 안의 CJS 호환 코드(require 등)를 위해 createRequire를 심는다.
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  logLevel: "info",
});

// 런타임에 필요한 외부 패키지만 적은 package.json. 컨테이너에서 이 폴더에 설치한다.
writeFileSync(
  resolve(root, "dist/package.json"),
  JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: "module", dependencies: Object.fromEntries(external) }, null, 2) + "\n",
);
console.log(`dist/main.js 완료 (외부 패키지 ${external.length}개: ${external.map(([n]) => n).join(", ")})`);
