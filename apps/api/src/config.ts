import type { Authenticate } from "./identity/domain/identity";
import { devAuthenticate } from "./identity/infrastructure/dev-authenticate";
import { supabaseAuthenticate } from "./identity/infrastructure/supabase-authenticate";

/** 기동 설정을 환경변수에서 읽고 검증한다. 운영에서 위험한 빈칸은 부팅을 거부한다. */

export class ConfigError extends Error {}

export type AuthMode = "supabase" | "dev";

export interface ApiConfig {
  production: boolean;
  port: number;
  authMode: AuthMode;
  jwtSecret?: string;
  databaseUrl?: string;
  dataDir: string;
  webOrigin: string;
  /** 앞단 프록시가 몇 겹인지. 0이면 X-Forwarded-For를 믿지 않는다. */
  trustProxyHops: number;
  /** 시작 로그에 찍을 경고 */
  warnings: string[];
}

const flag = (v: string | undefined) => v === "1" || v === "true";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const production = env.NODE_ENV === "production";
  const warnings: string[] = [];
  const jwtSecret = env.SUPABASE_JWT_SECRET?.trim() || undefined;
  const allowDev = flag(env.ALLOW_DEV_AUTH);

  let authMode: AuthMode;
  if (jwtSecret) {
    authMode = "supabase";
    if (production && allowDev) warnings.push("ALLOW_DEV_AUTH는 SUPABASE_JWT_SECRET이 있으면 무시돼요. 지워 주세요.");
  } else if (!production) {
    authMode = "dev";
    warnings.push("개발용 인증이에요. 쿼리나 헤더에 적은 이름이 곧 신원이 되니 외부에 열지 마세요.");
  } else if (allowDev) {
    authMode = "dev";
    warnings.push("경고: production인데 ALLOW_DEV_AUTH=1로 개발용 인증을 켰어요. 누구나 아무 사용자인 척할 수 있어요.");
  } else {
    throw new ConfigError(
      "NODE_ENV=production인데 SUPABASE_JWT_SECRET이 없어요. 시크릿을 설정하거나, 정말 개발용 인증이 필요하면 ALLOW_DEV_AUTH=1을 켜 주세요.",
    );
  }

  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError(`PORT가 올바르지 않아요: ${env.PORT}`);

  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  const dataDir = env.DATA_DIR ?? "./data";
  const webOrigin = env.WEB_ORIGIN ?? "http://localhost:3000";
  if (production) {
    if (!env.WEB_ORIGIN) warnings.push("WEB_ORIGIN이 없어 CORS 허용 주소가 http://localhost:3000이에요. 웹 주소를 설정해 주세요.");
    if (!databaseUrl && !env.DATA_DIR) warnings.push("DATABASE_URL도 DATA_DIR도 없어 ./data(실행 위치 기준)에 저장해요. 실행 위치가 바뀌면 빈 저장소로 떠요.");
    if (!databaseUrl && env.DATA_DIR === "memory") warnings.push("DATA_DIR=memory라서 서버를 끄면 모든 데이터가 사라져요.");
  }

  const hopsRaw = env.TRUST_PROXY;
  const hops = hopsRaw === undefined || hopsRaw === "" || hopsRaw === "0" || hopsRaw === "false" ? 0 : hopsRaw === "true" ? 1 : Number(hopsRaw);
  if (!Number.isInteger(hops) || hops < 0 || hops > 5) throw new ConfigError(`TRUST_PROXY는 0~5 사이 숫자(또는 1/true)여야 해요: ${hopsRaw}`);

  return { production, port, authMode, jwtSecret, databaseUrl, dataDir, webOrigin, trustProxyHops: hops, warnings };
}

export function authenticateFor(config: ApiConfig): Authenticate {
  return config.authMode === "supabase" && config.jwtSecret ? supabaseAuthenticate(config.jwtSecret) : devAuthenticate;
}
