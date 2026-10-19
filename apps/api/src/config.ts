import type { Authenticate } from "./identity/domain/identity";
import { DEFAULT_HTTP_RATE, type HttpRateOptions } from "./platform/http-rate-limit";
import { devAuthenticate } from "./identity/infrastructure/dev-authenticate";
import { createJwtVerifier } from "./identity/infrastructure/jwt-verifier";
import { supabaseAuthenticate } from "./identity/infrastructure/supabase-authenticate";

/** 기동 설정을 환경변수에서 읽고 검증한다. 운영에서 위험한 빈칸은 부팅을 거부한다. */

export class ConfigError extends Error {}

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  prefix: string;
}

export type AuthMode = "supabase" | "dev";

export interface ApiConfig {
  production: boolean;
  port: number;
  authMode: AuthMode;
  /** HS256 검증용 JWT Secret(레거시 키 방식) */
  jwtSecret?: string;
  /** Supabase 프로젝트 주소. 있으면 비대칭 서명 키(ES256/RS256)를 JWKS로 검증한다. */
  supabaseUrl?: string;
  /** 토큰 aud 검사 값(기본 authenticated) */
  jwtAudience: string;
  /** S3 호환 저장소(R2 등). 없으면 DB/파일 저장 */
  s3?: S3Config;
  databaseUrl?: string;
  /** DB TLS 방식. 없으면 접속 문자열(sslmode)을 따른다. */
  databaseSsl?: "off" | "no-verify" | "verify";
  databaseCaCert?: string;
  databasePoolMax: number;
  dataDir: string;
  webOrigin: string;
  /** 앞단 프록시가 몇 겹인지. 0이면 X-Forwarded-For를 믿지 않는다. */
  trustProxyHops: number;
  /** 모든 REST 요청에 거는 속도 제한 */
  httpRate: HttpRateOptions;
  /** 웹소켓 동시 연결 상한 */
  wsLimits: { perUser: number; perIp: number; perRoom: number };
  /** 연결이 없는 룸을 메모리에서 내리기까지의 분. 0이면 내리지 않는다. */
  roomIdleMinutes: number;
  /** 쓰이지 않는 이미지·오디오 자동 정리 */
  imageCleanup: { mode: "off" | "dry-run" | "on"; intervalHours: number; minAgeDays: number; maxDelete: number };
  /** 시작 로그에 찍을 경고 */
  warnings: string[];
}

const flag = (v: string | undefined) => v === "1" || v === "true";

/** 정수 환경변수. 비었으면 기본값, 범위를 벗어나면 부팅을 거부한다. */
function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name}은 ${min}~${max} 사이 정수여야 해요: ${raw}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const production = env.NODE_ENV === "production";
  const warnings: string[] = [];
  const jwtSecret = env.SUPABASE_JWT_SECRET?.trim() || undefined;
  const supabaseUrl = parseSupabaseUrl(env.SUPABASE_URL);
  const jwtAudience = env.SUPABASE_JWT_AUD?.trim() || "authenticated";
  const allowDev = flag(env.ALLOW_DEV_AUTH);

  let authMode: AuthMode;
  if (jwtSecret || supabaseUrl) {
    authMode = "supabase";
    if (production && allowDev) warnings.push("ALLOW_DEV_AUTH는 SUPABASE_URL이나 SUPABASE_JWT_SECRET이 있으면 무시돼요. 지워 주세요.");
  } else if (!production) {
    authMode = "dev";
    warnings.push("개발용 인증이에요. 쿼리나 헤더에 적은 이름이 곧 신원이 되니 외부에 열지 마세요.");
  } else if (allowDev) {
    authMode = "dev";
    warnings.push("경고: production인데 ALLOW_DEV_AUTH=1로 개발용 인증을 켰어요. 누구나 아무 사용자인 척할 수 있어요.");
  } else {
    throw new ConfigError(
      "NODE_ENV=production인데 SUPABASE_JWT_SECRET도 SUPABASE_URL도 없어요. 둘 중 하나(비대칭 키는 SUPABASE_URL)를 설정하거나, 정말 개발용 인증이 필요하면 ALLOW_DEV_AUTH=1을 켜 주세요.",
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

  const sslRaw = env.DATABASE_SSL?.trim().toLowerCase();
  if (sslRaw && !["off", "no-verify", "verify"].includes(sslRaw)) throw new ConfigError(`DATABASE_SSL은 off, no-verify, verify 중 하나여야 해요: ${sslRaw}`);
  const databasePoolMax = env.DB_POOL_MAX ? Number(env.DB_POOL_MAX) : 10;
  if (!Number.isInteger(databasePoolMax) || databasePoolMax < 1 || databasePoolMax > 100) throw new ConfigError(`DB_POOL_MAX는 1~100 사이 정수여야 해요: ${env.DB_POOL_MAX}`);
  if (production && sslRaw === "off" && databaseUrl) warnings.push("DATABASE_SSL=off라서 DB 연결이 암호화되지 않아요.");

  const hopsRaw = env.TRUST_PROXY;
  const hops = hopsRaw === undefined || hopsRaw === "" || hopsRaw === "0" || hopsRaw === "false" ? 0 : hopsRaw === "true" ? 1 : Number(hopsRaw);
  if (!Number.isInteger(hops) || hops < 0 || hops > 5) throw new ConfigError(`TRUST_PROXY는 0~5 사이 숫자(또는 1/true)여야 해요: ${hopsRaw}`);

  if (production && supabaseUrl?.startsWith("http://")) warnings.push("SUPABASE_URL이 http://예요. 운영에서는 https 주소를 쓰세요(공개키 목록을 평문으로 받게 돼요).");
  const s3 = parseS3(env);
  if (production && s3 && !databaseUrl && !env.DATA_DIR) warnings.push("이미지는 S3에 저장하지만 룸 저장소(DATABASE_URL)가 없어요. 룸 데이터는 로컬 파일에 쌓여요.");

  if (production && hops === 0) warnings.push("TRUST_PROXY가 0이에요. Fly·Render·Cloudflare 같은 프록시 뒤라면 1(겹 수)로 설정하세요. 아니면 IP별 제한이 모든 사용자를 한 사람으로 세어요.");

  const rateRaw = env.HTTP_RATE_LIMIT?.trim().toLowerCase();
  if (rateRaw && !["on", "off", "1", "0", "true", "false"].includes(rateRaw)) throw new ConfigError(`HTTP_RATE_LIMIT은 on 또는 off여야 해요: ${rateRaw}`);
  const httpRate: HttpRateOptions = {
    enabled: !(rateRaw === "off" || rateRaw === "0" || rateRaw === "false"),
    ipPerMin: intEnv(env, "HTTP_RATE_IP_PER_MIN", DEFAULT_HTTP_RATE.ipPerMin, 10, 1_000_000),
    userPerMin: intEnv(env, "HTTP_RATE_USER_PER_MIN", DEFAULT_HTTP_RATE.userPerMin, 10, 1_000_000),
  };
  const wsLimits = {
    perUser: intEnv(env, "WS_MAX_CONNS_PER_USER", 8, 1, 1000),
    perIp: intEnv(env, "WS_MAX_CONNS_PER_IP", 60, 1, 100_000),
    perRoom: intEnv(env, "WS_MAX_CONNS_PER_ROOM", 150, 1, 100_000),
  };
  const roomIdleMinutes = intEnv(env, "ROOM_IDLE_EVICT_MINUTES", 30, 0, 24 * 60);
  const cleanupRaw = env.IMAGE_CLEANUP?.trim().toLowerCase() || "off";
  if (!["off", "dry-run", "on"].includes(cleanupRaw)) throw new ConfigError(`IMAGE_CLEANUP은 off, dry-run, on 중 하나여야 해요: ${cleanupRaw}`);
  const imageCleanup = {
    mode: cleanupRaw as "off" | "dry-run" | "on",
    intervalHours: intEnv(env, "IMAGE_CLEANUP_INTERVAL_HOURS", 24, 1, 24 * 30),
    minAgeDays: intEnv(env, "IMAGE_CLEANUP_MIN_AGE_DAYS", 7, 1, 365),
    maxDelete: intEnv(env, "IMAGE_CLEANUP_MAX_DELETE", 500, 1, 1_000_000),
  };

  return { production, port, authMode, jwtSecret, supabaseUrl, jwtAudience, s3, databaseUrl, databaseSsl: sslRaw as ApiConfig["databaseSsl"], databaseCaCert: env.DATABASE_CA_CERT?.trim() || undefined, databasePoolMax, dataDir, webOrigin, trustProxyHops: hops, httpRate, wsLimits, roomIdleMinutes, imageCleanup, warnings };
}

function parseSupabaseUrl(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("protocol");
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    throw new ConfigError(`SUPABASE_URL이 올바른 주소가 아니에요 (예: https://abcdxyz.supabase.co): ${v.slice(0, 80)}`);
  }
}

function parseS3(env: NodeJS.ProcessEnv): S3Config | undefined {
  const bucket = env.S3_BUCKET?.trim();
  if (!bucket) return undefined;
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) throw new ConfigError("S3_BUCKET을 쓰려면 S3_ACCESS_KEY_ID와 S3_SECRET_ACCESS_KEY도 필요해요.");
  const endpoint = env.S3_ENDPOINT?.trim() || undefined;
  if (endpoint) {
    try {
      new URL(endpoint);
    } catch {
      throw new ConfigError(`S3_ENDPOINT가 올바른 주소가 아니에요: ${endpoint.slice(0, 80)}`);
    }
  }
  const prefix = (env.S3_PREFIX ?? "").replace(/^\/+|\/+$/g, "");
  return {
    endpoint,
    region: env.S3_REGION?.trim() || "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
    // R2·MinIO는 경로 방식이 안전하다. AWS S3는 가상 호스트 방식이 기본이라 endpoint가 없을 때만 끈다.
    forcePathStyle: env.S3_FORCE_PATH_STYLE === undefined ? Boolean(endpoint) : flag(env.S3_FORCE_PATH_STYLE),
    prefix,
  };
}

export function authenticateFor(config: ApiConfig): Authenticate {
  if (config.authMode !== "supabase") return devAuthenticate;
  return supabaseAuthenticate(
    createJwtVerifier({
      hsSecret: config.jwtSecret,
      jwksUrl: config.supabaseUrl ? `${config.supabaseUrl}/auth/v1/.well-known/jwks.json` : undefined,
      issuer: config.supabaseUrl ? `${config.supabaseUrl}/auth/v1` : undefined,
      audience: config.jwtAudience,
    }),
  );
}
