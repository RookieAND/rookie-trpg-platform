import { josa } from "@coc-vtt/shared";
import type { DiscordGateway } from "../domain/discord";

/** 웹훅으로 메시지를 보낸다. @everyone 같은 멘션은 사용자 입력이 섞여 있어도 울리지 않게 막는다. */
export class HttpDiscordGateway implements DiscordGateway {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {}

  async send(webhookUrl: string, content: string): Promise<void> {
    const res = await this.fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: "error",
    });
    if (!res.ok) throw new Error(`디스코드가 ${josa(String(res.status), "으로/로")} 응답했어요.`);
  }
}
