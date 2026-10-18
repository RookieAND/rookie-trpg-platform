import { randomBytes } from "node:crypto";
import { Room, type RoomOptions } from "@coc-vtt/room-core";
import type { Role } from "@coc-vtt/shared";
import { decideJoin, type JoinDecision } from "../domain/join-policy";
import type { DiscordEvents } from "../domain/discord";
import type { InviteConfig, RoomMeta, RoomRepository } from "../domain/room.repository";

export interface LoadedRoom {
  meta: RoomMeta;
  room: Room;
  /** 마지막으로 저장한 시점의 seq. 이보다 커졌으면 저장이 필요하다. */
  savedSeq: number;
}

export interface RegistryOptions {
  store: RoomRepository;
  room?: RoomOptions;
  now?: () => number;
  /** 변경 후 저장까지 기다리는 시간 */
  saveDebounceMs?: number;
}

const token = (bytes: number) => randomBytes(bytes).toString("base64url");

export class RoomRegistry {
  private loaded = new Map<string, Promise<LoadedRoom | null>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 룸마다 저장을 한 줄로 세운다. 겹쳐 쓰면 나중 것이 앞선 것을 덮을 수 있다. */
  private saving = new Map<string, Promise<void>>();
  private readonly now: () => number;
  private readonly debounce: number;
  /** 지운 룸. 늦게 도착한 저장이 되살리지 못하게 막는다. */
  private removed = new Set<string>();
  private removeListeners: Array<(roomId: string) => void> = [];

  constructor(private readonly opts: RegistryOptions) {
    this.now = opts.now ?? Date.now;
    this.debounce = opts.saveDebounceMs ?? 500;
  }

  roomCount() {
    return this.loaded.size;
  }

  /** 룸이 지워졌을 때 알림을 받는다(연결 끊기용). */
  onRemoved(cb: (roomId: string) => void) {
    this.removeListeners.push(cb);
  }

  /** 룸 주인만 룸을 지울 수 있다. 저장 대기와 진행 중인 저장을 정리한 뒤 저장소에서 지운다. */
  async remove(id: string, requesterId: string) {
    const entry = await this.get(id);
    if (!entry) return { ok: false as const, reason: "not_found" as const };
    if (entry.meta.ownerId !== requesterId) return { ok: false as const, reason: "forbidden" as const };
    this.removed.add(id);
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    await (this.saving.get(id) ?? Promise.resolve());
    await this.opts.store.remove(id);
    this.loaded.delete(id);
    for (const cb of this.removeListeners) cb(id);
    return { ok: true as const };
  }

  async create(ownerId: string, name: string): Promise<LoadedRoom> {
    const meta: RoomMeta = {
      id: token(8),
      name: name.trim().slice(0, 60),
      ownerId,
      createdAt: this.now(),
      invite: this.newInvite(null, 8),
    };
    const entry: LoadedRoom = { meta, room: new Room(meta.id, this.opts.room), savedSeq: -1 };
    this.loaded.set(meta.id, Promise.resolve(entry));
    await this.save(entry);
    return entry;
  }

  /** 메모리에 없으면 저장소에서 불러온다. 없는 룸이면 null. */
  get(id: string): Promise<LoadedRoom | null> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return Promise.resolve(null);
    let p = this.loaded.get(id);
    if (!p) {
      p = this.opts.store.load(id).then((stored) => {
        if (!stored) return null;
        const room = stored.data ? Room.fromData(stored.data, this.opts.room) : new Room(id, this.opts.room);
        return { meta: stored.meta, room, savedSeq: room.currentSeq };
      });
      this.loaded.set(id, p);
      // 없는 룸은 캐시하지 않는다.
      p.then((r) => {
        if (!r) this.loaded.delete(id);
      }).catch(() => this.loaded.delete(id));
    }
    return p;
  }

  async listFor(userId: string) {
    const stored = await this.opts.store.listFor(userId);
    // 방금 참가해 아직 저장 전인 룸도 있으므로, 메모리에 올라온 룸에서도 찾는다.
    const ids = new Set(stored.map((s) => s.meta.id));
    for (const p of this.loaded.values()) {
      const live = await p;
      if (!live || ids.has(live.meta.id)) continue;
      const members = live.room.snapshot({ userId: "", role: "spectator" }).members;
      if (live.meta.ownerId === userId || members.some((m) => m.userId === userId)) ids.add(live.meta.id);
    }
    const out: Array<{ meta: RoomMeta; status: string; sessionNumber: number; online: number; role: Role | null }> = [];
    for (const id of ids) {
      // 메모리에 올라온 룸은 그쪽 상태가 더 새롭다.
      const live = await this.get(id);
      if (!live) continue;
      out.push({ meta: live.meta, ...this.describe(live, userId) });
    }
    return out.sort((a, b) => b.meta.createdAt - a.meta.createdAt);
  }

  describe(entry: LoadedRoom, userId: string) {
    const snap = entry.room.snapshot({ userId: "", role: "spectator" });
    const me = snap.members.find((m) => m.userId === userId);
    return {
      status: snap.sessionStatus,
      sessionNumber: snap.sessionNumber,
      online: snap.members.filter((m) => m.online).length,
      role: entry.meta.ownerId === userId ? ("kp" as Role) : (me?.role ?? null),
    };
  }

  /** 이 사용자가 이 룸에 어떤 역할로 들어올 수 있는지 정한다. */
  decideJoin(entry: LoadedRoom, userId: string, requested: Role, inviteCode: string | null): JoinDecision {
    const members = entry.room.snapshot({ userId: "", role: "spectator" }).members;
    return decideJoin(entry.meta, members, userId, requested, inviteCode, this.now());
  }

  async regenerateInvite(id: string, requesterId: string, opts: { expiresInMinutes?: number | null; maxMembers?: number }) {
    const entry = await this.get(id);
    if (!entry) return { ok: false as const, reason: "not_found" as const };
    if (entry.meta.ownerId !== requesterId) return { ok: false as const, reason: "forbidden" as const };
    const expires =
      opts.expiresInMinutes === undefined || opts.expiresInMinutes === null ? null : opts.expiresInMinutes * 60_000;
    entry.meta.invite = this.newInvite(expires, opts.maxMembers ?? entry.meta.invite.maxMembers);
    await this.save(entry);
    return { ok: true as const, invite: entry.meta.invite };
  }

  /**
   * 디스코드 알림 설정을 바꾼다. 룸 주인만 할 수 있다.
   * webhookUrl: 문자열이면 교체, null이면 해제, 생략하면 저장된 주소를 두고 알림 종류만 바꾼다.
   */
  async setDiscord(id: string, requesterId: string, change: { webhookUrl?: string | null; events: DiscordEvents }) {
    const entry = await this.get(id);
    if (!entry) return { ok: false as const, reason: "not_found" as const };
    if (entry.meta.ownerId !== requesterId) return { ok: false as const, reason: "forbidden" as const };
    if (change.webhookUrl === null) {
      delete entry.meta.discord;
    } else {
      const webhookUrl = change.webhookUrl ?? entry.meta.discord?.webhookUrl;
      if (!webhookUrl) return { ok: false as const, reason: "no_webhook" as const };
      entry.meta.discord = { webhookUrl, events: change.events };
    }
    await this.save(entry);
    return { ok: true as const, connected: Boolean(entry.meta.discord) };
  }

  private newInvite(expiresInMs: number | null, maxMembers: number): InviteConfig {
    return {
      code: token(6),
      expiresAt: expiresInMs === null ? null : this.now() + expiresInMs,
      maxMembers,
    };
  }

  // ── 저장 ─────────────────────────────────────────────

  /** 변경이 있으면 곧 저장한다. immediate면 기다리지 않는다. */
  markChanged(entry: LoadedRoom, immediate = false) {
    if (entry.room.currentSeq === entry.savedSeq) return;
    const id = entry.meta.id;
    if (this.removed.has(id)) return;
    const pending = this.timers.get(id);
    if (immediate) {
      if (pending) clearTimeout(pending);
      this.timers.delete(id);
      this.saveInBackground(entry);
      return;
    }
    if (pending) return;
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        this.saveInBackground(entry);
      }, this.debounce),
    );
  }

  save(entry: LoadedRoom): Promise<void> {
    const id = entry.meta.id;
    const run = (this.saving.get(id) ?? Promise.resolve()).then(async () => {
      if (this.removed.has(id)) return;
      // 차례가 왔을 때의 최신 상태를 저장한다.
      const seq = entry.room.currentSeq;
      await this.opts.store.save({ meta: entry.meta, data: entry.room.toData() });
      entry.savedSeq = Math.max(entry.savedSeq, seq);
    });
    // 한 번 실패해도 다음 저장은 계속 시도한다.
    const tail = run.catch(() => {});
    this.saving.set(id, tail);
    void tail.then(() => {
      if (this.saving.get(id) === tail) this.saving.delete(id);
    });
    return run;
  }

  /** 기다리지 않는 저장. 실패해도 서버가 죽지 않게 기록만 남기고, 다음 변경 때 다시 시도한다. */
  private saveInBackground(entry: LoadedRoom) {
    this.save(entry).catch((e) => console.error(`room ${entry.meta.id} 저장 실패:`, e));
  }

  async flushAll() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    const all = await Promise.all([...this.loaded.values()]);
    await Promise.all(all.filter((e): e is LoadedRoom => !!e && e.room.currentSeq !== e.savedSeq).map((e) => this.save(e)));
  }
}
