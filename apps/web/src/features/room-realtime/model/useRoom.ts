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

export type Connection = "connecting" | "open" | "closed";

interface Params {
  roomId: string;
  user: string;
  name: string;
  /** 디스코드 로그인 토큰. 있으면 user/name 대신 이것으로 인증한다. */
  token?: string;
  /** 초대 코드. 이미 멤버이거나 KP면 필요 없다. */
  invite?: string;
}

/**
 * 룸 연결 훅. 끊기면 지수 백오프로 다시 붙고, 붙을 때마다 lastSeq를 보내
 * 놓친 이벤트만 받는다(버퍼를 넘기면 서버가 snapshot을 준다).
 */
export function useRoom({ roomId, user, name, token, invite }: Params) {
  const [state, dispatch] = useReducer(
    (s: RoomState, m: ServerMessage) => applyServerMessage(s, m),
    roomId,
    initialRoomState,
  );
  const [connection, setConnection] = useState<Connection>("connecting");
  const [closeCode, setCloseCode] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastSeq = useRef(0);
  lastSeq.current = state.lastSeq;
  const reqId = useRef(0);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      setConnection("connecting");
      const qs = new URLSearchParams(token ? { room: roomId, token } : { room: roomId, user, name });
      if (invite) qs.set("invite", invite);
      const ws = new WebSocket(`${REALTIME_URL}?${qs}`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnection("open");
        setCloseCode(null);
        ws.send(JSON.stringify({ type: "join", data: lastSeq.current > 0 ? { lastSeq: lastSeq.current } : {} }));
      };
      ws.onmessage = (e) => dispatch(JSON.parse(e.data as string) as ServerMessage);
      ws.onclose = (e) => {
        setConnection("closed");
        setCloseCode(e.code);
        // 인증 실패, 접근 거절, 없는 룸, 정원 초과는 다시 붙어도 소용없다.
        if (stopped || (e.code >= 4401 && e.code <= 4409 && e.code !== 4408)) return;
        const delay = Math.min(10_000, 500 * 2 ** attempt++);
        timer = setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [roomId, user, name, token, invite]);

  const send = useCallback((command: ClientCommand) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ id: String(++reqId.current), command }));
    return true;
  }, []);

  return { state, connection, closeCode, send };
}
