/**
 * 구조화 로그. 한 줄에 JSON 하나라서 호스트(Fly, Render, Railway)의 로그 수집기가 그대로 읽는다.
 * 비밀 값은 기록 직전에 가린다: 웹훅 주소, 토큰(JWT), Bearer, ?token=, DB 접속 문자열의 비밀번호, 액세스 키.
 */

export type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const RULES: Array<[RegExp, string]> = [
  [/https?:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"'<>)]*/gi, "[웹훅 주소]"],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, "[토큰]"],
  [/(bearer\s+)[\w.~+/=-]+/gi, "$1[가림]"],
  [/\b((?:access_|refresh_|id_)?token|apikey|api_key|secret|password|passwd)(\s*[=:]\s*)(?!\[가림\])[^\s&"',;\\]+/gi, "$1$2[가림]"],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@\s/]+@/gi, "$1[가림]@"],
  [/\b(AKIA|ASIA)[A-Z0-9]{12,}\b/g, "[액세스키]"],
];

export const redact = (text: string): string => RULES.reduce((t, [re, to]) => t.replace(re, to), text);

/** 오류를 로그에 실을 수 있는 모양으로 바꾼다(스택 포함, 비밀 값은 가림). */
export function errFields(e: unknown): { err: { name: string; message: string; stack?: string } } {
  if (e instanceof Error) {
    return { err: { name: e.name, message: redact(e.message), ...(e.stack ? { stack: redact(e.stack).split("\n").slice(0, 12).join("\n") } : {}) } };
  }
  return { err: { name: "NonError", message: redact(String(e)).slice(0, 500) } };
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  level?: Level;
  /** 한 줄을 받는 곳. 기본은 error/warn은 stderr, 나머지는 stdout */
  sink?: (line: string, level: Level) => void;
  now?: () => number;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const min = ORDER[opts.level ?? "info"];
  const now = opts.now ?? Date.now;
  const sink =
    opts.sink ??
    ((line, level) => {
      (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
    });
  const emit = (level: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < min) return;
    try {
      const line = JSON.stringify({ t: new Date(now()).toISOString(), level, msg: redact(msg), ...fields });
      sink(redact(line), level);
    } catch {
      /* 로그 때문에 서버가 흔들리면 안 된다 */
    }
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

const envLevel = (process.env.LOG_LEVEL ?? "").toLowerCase();
/** 프로세스 전체 기본 로거. LOG_LEVEL=debug|info|warn|error */
export let log: Logger = createLogger({ level: envLevel in ORDER ? (envLevel as Level) : "info" });

/** 시험에서 로그를 가로채기 위해 바꿔 끼운다. */
export function setLogger(next: Logger): Logger {
  const prev = log;
  log = next;
  return prev;
}
