import { describeOutcome, type ServerEvent } from "@coc-vtt/shared";

export interface DiscordEvents {
  /** 세션 시작·일시정지·재개·종료 */
  session: boolean;
  /** 공개 굴림 결과(KP의 비밀 굴림은 어떤 경우에도 보내지 않는다) */
  rolls: boolean;
}

export interface DiscordConfig {
  /** 디스코드 채널 웹훅 주소. 비밀 값이라 API로 다시 돌려주지 않는다. */
  webhookUrl: string;
  events: DiscordEvents;
}

/** 디스코드 웹훅 주소만 받는다. 임의 주소를 받으면 서버가 엉뚱한 곳에 요청을 보내게 된다(SSRF). */
const WEBHOOK = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,200}$/;
export const isValidWebhookUrl = (url: string) => WEBHOOK.test(url);

/** 알림을 실제로 보내는 쪽(포트). 구현은 infrastructure에 둔다. */
export interface DiscordGateway {
  send(webhookUrl: string, content: string): Promise<void>;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plain = (s: string) => clip(s.replace(/[`\r\n]+/g, " ").trim(), 60);

/** 룸 이벤트를 디스코드 메시지로. 보내지 않을 이벤트는 null. */
export function formatNotification(event: ServerEvent, ctx: { roomName: string }, events: DiscordEvents): string | null {
  const room = `**${plain(ctx.roomName)}**`;
  switch (event.type) {
    case "session.started":
      return events.session ? `🎲 ${room} · 세션 ${event.data.number}을(를) 시작했어요.` : null;
    case "session.paused":
      return events.session ? `⏸️ ${room} · 세션이 일시정지됐어요${event.data.reason === "kp_disconnected" ? " (KP 연결이 끊겼어요)" : ""}.` : null;
    case "session.resumed":
      return events.session ? `▶️ ${room} · 세션을 이어가요.` : null;
    case "session.ended":
      return events.session ? `🏁 ${room} · 세션이 끝났어요.` : null;
    case "roll.result": {
      const r = event.data;
      if (!events.rolls || r.secret) return null;
      const who = r.label ? `${plain(r.userName)} · ${plain(r.label)}` : plain(r.userName);
      return `🎲 ${room} · **${who}** \`${plain(r.expr)}\` → ${describeOutcome(r.outcome)}`;
    }
    default:
      return null;
  }
}
