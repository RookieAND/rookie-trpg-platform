import type { RoomRepository, StoredRoom } from "../domain/room.repository";
import { involvesUser } from "../domain/room.repository";

export class MemoryRoomRepository implements RoomRepository {
  private rooms = new Map<string, string>();

  async load(id: string) {
    const raw = this.rooms.get(id);
    return raw ? (JSON.parse(raw) as StoredRoom) : null;
  }

  async save(room: StoredRoom) {
    this.rooms.set(room.meta.id, JSON.stringify(room));
  }

  async remove(id: string) {
    this.rooms.delete(id);
  }

  async listFor(userId: string) {
    return [...this.rooms.values()].map((r) => JSON.parse(r) as StoredRoom).filter((r) => involvesUser(r, userId));
  }
}
