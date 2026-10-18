"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { REALTIME_URL } from "@/shared/config";
import {
  applyServerMessage,
  initialRoomState,
  type ClientCommand,
  type RoomState,
  type ServerMessage,
} from "@coc-vtt/shared";
import { backoffMs, nextAfterClose } from "./reconnect";

export type Connection = "connecting" | "open" | "closed";

/** 토큰 갱신 결과. 개발용 로그인은 갱신 수단을 넘기지 않는다. */
export type TokenRefresh = () => Promise<{ status: "ok"; identity: { token?: string } } | { status: "invalid" | "unreachable" }>;

interface Params {
  roomId: string;
  user: string;
  name: string;
  /** 디스코드 로그인 토큰. 있으면 user/name 대신 이것으로 인증한다. */
  token?: string;
  /** 초대 코드. 이미 멤버이거나 KP면 필요 없다. */
  invite?: string;
  /** 만료된 토큰으로 4401을 받았을 때 새 토큰을 받아 오는 함수. */
  refresh?: TokenRefresh;
}

export interface RetryInfo {
  /** 연속으로 실패한 횟수(연결에 성공하면 0). */
  attempt: number;
  /** 다음 시도 시각(ms, Date.now 기준). 대기 중이 아니면 null. */
  nextAt: number | null;
}

/**
 * 룸 연결 훅. 끊기면 지수 백오프로 다시 붙고, 붙을 때마다 lastSeq를 보내
 * 놓친 이벤트만 받는다(버퍼를 넘기면 서버가 snapshot을 준다).
 * 토큰 로그인이 만료돼 4401을 받으면 `refresh`로 한 번 갱신해 새 토큰으로 다시 붙는다.
 */
export function useRoom({ roomId, user, name, token: initialToken, invite, refresh }: Params) {
  const [state, dispatch] = useReducer(
    (s: RoomState, m: ServerMessage) => applyServerMessage(s, m),
    roomId,
    initialRoomState,
  );
  const [connection, setConnection] = useState<Connection>("connecting");
  const [closeCode, setCloseCode] = useState<number | null>(null);
  const [retry, setRetry] = useState<RetryInfo>({ attempt: 0, nextAt: null });
  /** 끊겼다가 다시 붙을 때마다 1씩 오른다. */
  const [reconnected, setReconnected] = useState(0);
  /** 연결이 없어 명령을 보내지 못한 횟수. */
  const [sendFailed, setSendFailed] = useState(0);
  /** 로그인 만료를 갱신하지 못했다. */
  const [authExpired, setAuthExpired] = useState(false);
  // 갱신으로 받은 토큰. 부모가 준 토큰이 바뀌면(다시 로그인) 그쪽이 이긴다.
  const [refreshed, setRefreshed] = useState<{ from: string | undefined; token: string } | null>(null);
  const token = refreshed && refreshed.from === initialToken ? refreshed.token : initialToken;
  const wsRef = useRef<WebSocket | null>(null);
  const lastSeq = useRef(0);
  lastSeq.current = state.lastSeq;
  const reqId = useRef(0);
  const wasDown = useRef(false);
  const everOpened = useRef(false);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let triedRefresh = token !== initialToken;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      const delay = backoffMs(attempt++);
      setRetry({ attempt, nextAt: Date.now() + delay });
      timer = setTimeout(connect, delay);
    };

    const connect = () => {
      setConnection("connecting");
      const qs = new URLSearchParams(token ? { room: roomId, token } : { room: roomId, user, name });
      if (invite) qs.set("invite", invite);
      const ws = new WebSocket(`${REALTIME_URL}?${qs}`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setRetry({ attempt: 0, nextAt: null });
        setConnection("open");
        setCloseCode(null);
        setAuthExpired(false);
        if (wasDown.current && everOpened.current) setReconnected((n) => n + 1);
        everOpened.current = true;
        wasDown.current = false;
        ws.send(JSON.stringify({ type: "join", data: lastSeq.current > 0 ? { lastSeq: lastSeq.current } : {} }));
      };
      ws.onmessage = (e) => dispatch(JSON.parse(e.data as string) as ServerMessage);
      ws.onclose = (e) => {
        wasDown.current = true;
        const action = nextAfterClose({ code: e.code, stopped, hasToken: Boolean(token), canRefresh: Boolean(refreshRef.current), alreadyRefreshed: triedRefresh });
        if (action === "refresh") {
          // 만료된 로그인: 닫힘 코드는 화면에 드러내지 않고 갱신을 시도한다.
          triedRefresh = true;
          setConnection("connecting");
          void refreshRef.current!().then((r) => {
            if (stopped) return;
            if (r.status === "ok" && r.identity.token) setRefreshed({ from: initialToken, token: r.identity.token }); // 효과가 새 토큰으로 다시 시작된다.
            else if (r.status === "unreachable") {
              triedRefresh = false;
              setConnection("closed");
              schedule();
            } else {
              setConnection("closed");
              setCloseCode(4401);
              setAuthExpired(true);
            }
          });
          return;
        }
        setConnection("closed");
        setCloseCode(e.code);
        if (action === "stop") {
          setRetry({ attempt, nextAt: null });
          if (e.code === 4401 && token && !stopped) setAuthExpired(true);
          return;
        }
        schedule();
      };
    };
    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [roomId, user, name, token, initialToken, invite]);

  const send = useCallback((command: ClientCommand) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setSendFailed((n) => n + 1);
      return false;
    }
    ws.send(JSON.stringify({ id: String(++reqId.current), command }));
    return true;
  }, []);

  return { state, connection, closeCode, send, retry, reconnected, sendFailed, authExpired };
}
