import { errFields, log as defaultLog, type Logger } from "./log";

export interface GuardTarget {
  on(event: "unhandledRejection", cb: (reason: unknown) => void): unknown;
  on(event: "uncaughtException", cb: (err: Error) => void): unknown;
  on(event: "SIGTERM" | "SIGINT", cb: () => void): unknown;
}

/**
 * 프로세스 수준 안전망.
 *  - unhandledRejection: 기록만 하고 계속 돈다. 한 요청의 빠뜨린 catch가 모든 룸을 내리지 않게 한다.
 *  - uncaughtException: 프로세스 상태를 믿을 수 없으니 stop(…, 1)로 저장하고 0이 아닌 코드로 내려간다(호스트가 다시 띄운다).
 *  - SIGTERM / SIGINT: stop(…, 0)로 정상 종료.
 */
export function installProcessGuards(stop: (reason: string, code: number) => unknown, proc: GuardTarget = process, log: Logger = defaultLog) {
  proc.on("SIGTERM", () => void stop("SIGTERM", 0));
  proc.on("SIGINT", () => void stop("SIGINT", 0));
  proc.on("unhandledRejection", (reason) => log.error("unhandledRejection", errFields(reason)));
  proc.on("uncaughtException", (err) => {
    log.error("uncaughtException", errFields(err));
    void stop("uncaughtException", 1);
  });
}
