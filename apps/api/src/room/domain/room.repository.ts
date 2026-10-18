import type { RoomData } from "@coc-vtt/room-core";
import type { DiscordConfig } from "./discord";

export interface InviteConfig {
  code: string;
  /** 만료 시각(ms). null이면 만료 없음. */
  expiresAt: number | null;
  maxMembers: number;
}

export interface RoomMeta {
  id: string;
  name: string;
  /** 룸을 만든 사용자. 이 사용자만 GM이 된다. */
  ownerId: string;
  createdAt: number;
  invite: InviteConfig;
  /** 디스코드 알림 설정. 없으면 알림을 보내지 않는다. */
  discord?: DiscordConfig;
}

export interface StoredRoom {
  meta: RoomMeta;
  data: RoomData | null;
}

/**
 * 룸 저장소(포트). 지금은 파일/메모리 구현만 있고, 같은 인터페이스로
 * Postgres(Supabase) 어댑터를 붙일 수 있다.
 */
export interface RoomRepository {
  load(id: string): Promise<StoredRoom | null>;
  save(room: StoredRoom): Promise<void>;
  /** 사용자가 만들었거나 참가한 룸 */
  listFor(userId: string): Promise<StoredRoom[]>;
  /** 룸을 통째로 지운다. 없는 룸이면 아무 일도 없다. */
  remove(id: string): Promise<void>;
  /** 저장된 모든 룸을 하나씩. 정리 작업(쓰이지 않는 이미지 찾기)용이라 느려도 괜찮다. */
  listAll(): AsyncIterable<StoredRoom>;
}

/** 룸을 만들었거나 멤버로 참가한 사용자인지 */
export function involvesUser(r: StoredRoom, userId: string) {
  return r.meta.ownerId === userId || Boolean(r.data?.members.some((m) => m.userId === userId));
}
