import { Body, Controller, HttpCode, HttpException, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { AuthService } from "../../../identity/application/auth.service";
import { SheetImportService } from "../../application/sheet-import.service";
import type { SheetImportCode } from "../../domain/sheet-import";

const FAIL: Record<SheetImportCode, [status: number, message: string]> = {
  bad_url: [400, "구글 시트 주소가 아니에요. docs.google.com/spreadsheets/d/… 로 시작하는 링크를 붙여 넣어 주세요."],
  not_shared: [422, "시트를 읽지 못했어요. 공유를 ‘링크가 있는 모든 사용자 - 보기’로 바꿨는지 확인해 주세요."],
  not_found: [404, "시트를 찾지 못했어요. 링크가 맞는지 확인해 주세요."],
  not_csv: [422, "받은 내용이 표(CSV)가 아니에요. 링크와 공유 설정을 확인해 주세요."],
  too_large: [413, "시트가 너무 커요. 1MB까지 가져올 수 있어요."],
  timeout: [504, "구글이 8초 안에 답하지 않았어요. 잠시 뒤에 다시 해 주세요."],
  upstream: [502, "구글 시트에서 받아 오지 못했어요. 잠시 뒤에 다시 해 주세요."],
  redirect: [502, "구글이 허용하지 않는 주소로 안내해서 가져오지 못했어요."],
  rate_limited: [429, "너무 자주 불러왔어요. 잠시 뒤에 다시 해 주세요."],
};

/** 링크 공유된 구글 시트를 서버가 대신 CSV로 받아 준다(한 번 가져오기만, 쓰기·계속 연결 없음). */
@Controller("sheet-import")
export class SheetImportController {
  constructor(
    @Inject(SheetImportService) private readonly service: SheetImportService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Post("google")
  @HttpCode(200)
  async google(@Req() req: IncomingMessage, @Body() body: unknown) {
    const me = this.auth.fromRequest(req);
    if (!me) throw new UnauthorizedException("로그인이 필요해요.");
    const url = body && typeof body === "object" ? (body as { url?: unknown }).url : undefined;
    const r = await this.service.fetchCsv(me.userId, url);
    if (!r.ok) {
      const [status, message] = FAIL[r.code];
      throw new HttpException(message, status);
    }
    return { csv: r.csv };
  }
}
