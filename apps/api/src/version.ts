import { readFileSync } from "node:fs";

/** /health에 보여 줄 버전. APP_VERSION(배포 시 커밋 해시 등)이 있으면 그것을, 없으면 package.json 버전을 쓴다. */
function readVersion(): string {
  const fromEnv = process.env.APP_VERSION?.trim();
  if (fromEnv) return fromEnv.slice(0, 40);
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const APP_VERSION = readVersion();
