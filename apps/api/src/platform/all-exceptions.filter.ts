import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { errFields, log } from "./log";

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
    const known = exception instanceof HttpException;
    const status = known ? exception.getStatus() : 500;
    if (!known || status >= 500) {
      log.error("요청 처리 중 예외", { method: req.method, path: (req.url ?? "").split("?")[0], status, ...errFields(exception) });
    }
    if (res.headersSent) return void res.end();
    const body = known ? exception.getResponse() : { statusCode: 500, message: "서버에 문제가 생겼어요. 잠시 뒤에 다시 해 주세요." };
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(typeof body === "string" ? { statusCode: status, message: body } : body));
  }
}
