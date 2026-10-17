import type { IncomingMessage } from "node:http";
import { Inject } from "@nestjs/common";
import { OnGatewayConnection, WebSocketGateway } from "@nestjs/websockets";
import type { WebSocket } from "ws";
import { RoomHub } from "./room.hub";

/**
 * 실시간 게이트웨이. 프로토콜이 자체 봉투({id, command})라서
 * Nest의 @SubscribeMessage 대신 연결만 받아 허브에 넘긴다.
 */
@WebSocketGateway({ path: "/ws", maxPayload: 16 * 1024 })
export class RoomGateway implements OnGatewayConnection {
  constructor(@Inject(RoomHub) private readonly hub: RoomHub) {}

  handleConnection(client: WebSocket, req: IncomingMessage): void {
    this.hub.attach(client, req);
  }
}
