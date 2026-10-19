import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { errFields, log } from "./log";

/** body-parser·Express가 던지는 요청 오류(http-errors 모양: status, type). 파서 내부 문구는 응답에 싣지 않는다. */
function clientError(e: unknown): { status: number; type: string; message: string } | null {
  if (!e || typeof e !== "object" || e instanceof HttpException) return null;
  const { status, type } = e as { status?: unknown; type?: unknown };
  if (typeof status !== "number" || status < 400 || status > 499) return null;
  const t = typeof type === "string" ? type : "request";
  if (t === "entity.too.large") return { status: 413, type: t, message: "요청 내용이 너무 커요. 크기를 줄여서 다시 보내 주세요." };
  if (t === "entity.parse.failed") return { status: 400, type: t, message: "요청 형식이 올바르지 않아요." };
  if (t === "request.aborted") return { status: 400, type: t, message: "요청이 중간에 끊겼어요." };
  return { status: 400, type: t, message: "요청이 올바르지 않아요." };
}

/**
 * 컨트롤러에서 처리되지 않은 예외를 한 곳에서 받는다. 의도한 오류(HttpException)는 그대로 돌려주고,
 * 예상 못 한 오류는 구조화 로그로 남기고 응답에는 내부 내용 없이 안내 문장만 싣는다.
 * 주소는 쿼리를 떼고 기록한다(웹소켓·미디어 주소의 token 쿼리가 로그에 남지 않게).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<IncomingMessage>();
    const res = http.getResponse<ServerResponse>();
    // 본문 파서(body-parser)가 던지는 오류는 요청이 잘못된 것이지 서버 오류가 아니다. 413/400으로 답하고 오류 로그는 남기지 않는다.
    const client = clientError(exception);
    const known = exception instanceof HttpException || client !== null;
    const status = exception instanceof HttpException ? exception.getStatus() : (client?.status ?? 500);
    if (client) log.debug("잘못된 요청", { method: req.method, path: (req.url ?? "").split("?")[0], status, type: client.type });
    else if (!known || status >= 500) {
      log.error("요청 처리 중 예외", { method: req.method, path: (req.url ?? "").split("?")[0], status, ...errFields(exception) });
    }
    if (res.headersSent) return void res.end();
    const body = client ? { statusCode: client.status, message: client.message } : exception instanceof HttpException ? exception.getResponse() : { statusCode: 500, message: "서버에 문제가 생겼어요. 잠시 뒤에 다시 해 주세요." };
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(typeof body === "string" ? { statusCode: status, message: body } : body));
  }
}
