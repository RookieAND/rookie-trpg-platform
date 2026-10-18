import { MAX_FOG_EXPLORED, type ClientCommand, FogArea, FogZone, GameObject, Member, Scene } from "@coc-vtt/shared";

/**
 * KP의 '되돌리기'. 되돌릴 수 있는 동작(토큰·오브젝트 추가/이동/수정/삭제, 안개 영역·탐험 기록)만
 * 이전 값을 기록해 둔다. 메모리에만 있고 저장 데이터에는 넣지 않는다.
 * 이 파일은 상태를 직접 바꾸지 않는 부분(기록·판정)과, 오브젝트·장면 맵만 고치는 되돌림을 맡고,
 * 이벤트 만들기는 Room이 기존 경로(fanOutObject·emitScene)로 한다.
 */

export const MAX_UNDO = 20;

interface FogSnap {
  zones: FogZone[];
  explored: FogArea[] | undefined;
}

type FogCmd = "fog.reveal" | "fog.remove" | "fog.clear" | "fog.forget";

export type UndoEntry =
  | { kind: "add"; id: string; rev: number; label: string }
  | { kind: "move"; id: string; x: number; y: number; rev: number; prevRev: number; label: string }
  | { kind: "update"; before: GameObject; rev: number; prevRev: number; label: string }
  | { kind: "remove"; obj: GameObject; label: string }
  | { kind: "fog"; cmd: FogCmd; sceneId: string; before: FogSnap; after: FogSnap; label: string };

export interface Pending {
  command: ClientCommand;
  obj?: GameObject;
  fog?: FogSnap;
}

interface Maps {
  objects: Map<string, GameObject>;
  scenes: Map<string, Scene>;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const fogSnap = (scene: Scene | undefined): FogSnap => ({
  zones: clone(scene?.fog?.zones ?? []),
  explored: clone(scene?.fog?.explored),
});

const kindKo = (o: GameObject) => (o.kind === "token" ? "토큰" : "오브젝트");

export class UndoLog {
  private entries: UndoEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(e: UndoEntry): void {
    this.entries.push(e);
    if (this.entries.length > MAX_UNDO) this.entries.shift();
  }

  /** 명령을 처리하기 전 상태를 붙잡아 둔다. 되돌릴 수 없는 명령이면 null. */
  capture(command: ClientCommand, maps: Maps): Pending | null {
    switch (command.type) {
      case "object.add":
        return { command };
      case "object.move":
      case "object.update": {
        const o = maps.objects.get(command.data.id);
        return o ? { command, obj: { ...o } } : null;
      }
      case "object.remove": {
        const o = maps.objects.get(command.data.id);
        return o ? { command, obj: { ...o } } : null;
      }
      case "fog.reveal":
      case "fog.remove":
      case "fog.clear":
      case "fog.forget":
        return { command, fog: fogSnap(maps.scenes.get(command.data.sceneId)) };
      default:
        return null;
    }
  }

  /** 명령이 성공한 뒤 기록을 남긴다. */
  commit(p: Pending, maps: Maps): void {
    const c = p.command;
    switch (c.type) {
      case "object.add": {
        const o = [...maps.objects.values()].at(-1);
        if (o) this.push({ kind: "add", id: o.id, rev: o.rev, label: `${kindKo(o)} '${o.name}' 추가` });
        return;
      }
      case "object.move": {
        const now = maps.objects.get(c.data.id);
        if (now && p.obj) this.push({ kind: "move", id: now.id, x: p.obj.x, y: p.obj.y, rev: now.rev, prevRev: p.obj.rev, label: `${kindKo(now)} '${now.name}' 이동` });
        return;
      }
      case "object.update": {
        const now = maps.objects.get(c.data.id);
        if (now && p.obj) this.push({ kind: "update", before: p.obj, rev: now.rev, prevRev: p.obj.rev, label: `${kindKo(now)} '${p.obj.name}' 수정` });
        return;
      }
      case "object.remove":
        if (p.obj) this.push({ kind: "remove", obj: p.obj, label: `${kindKo(p.obj)} '${p.obj.name}' 삭제` });
        return;
      case "fog.reveal":
      case "fog.remove":
      case "fog.clear":
      case "fog.forget": {
        if (!p.fog) return;
        const label = { "fog.reveal": "안개 영역 밝히기", "fog.remove": "안개 영역 지우기", "fog.clear": "안개 영역 모두 지우기", "fog.forget": "탐험 기록 지우기" }[c.type];
        this.push({ kind: "fog", cmd: c.type, sceneId: c.data.sceneId, before: p.fog, after: fogSnap(maps.scenes.get(c.data.sceneId)), label });
        return;
      }
    }
  }

  /** 되돌리며 rev가 올랐으니, 되돌린 동작 직전 상태(rev=from)를 기다리던 앞선 기록이 새 rev를 기다리게 한다. */
  private rebase(id: string, from: number, to: number): void {
    for (const x of this.entries) {
      if ((x.kind === "add" || x.kind === "move") && x.id === id && x.rev === from) x.rev = to;
      else if (x.kind === "update" && x.before.id === id && x.rev === from) x.rev = to;
    }
  }

  /**
   * 가장 최근 기록을 되돌린다. 대상이 달라졌으면 그 기록은 버리고(다음 기록으로 넘어가지 않고) 오류를 낸다.
   * 되돌린 오브젝트(before/after)나 장면은 Room이 이벤트로 알린다.
   */
  undo(maps: Maps, members: Map<string, Member>, maxObjects: number): UndoResult {
    const e = this.entries.pop();
    if (!e) return { ok: false, message: "되돌릴 기록이 없어요." };
    const stale = (): UndoResult => ({ ok: false, message: `되돌릴 수 없어요. '${e.label}' 뒤에 대상이 바뀌었거나 사라졌어요.` });
    const isPl = (id: string | undefined) => !!id && members.get(id)?.role === "pl";
    switch (e.kind) {
      case "add": {
        const o = maps.objects.get(e.id);
        if (!o || o.rev !== e.rev) return stale();
        maps.objects.delete(e.id);
        return { ok: true, label: e.label, obj: { before: o, after: null } };
      }
      case "move": {
        const o = maps.objects.get(e.id);
        if (!o || o.rev !== e.rev) return stale();
        const before = { ...o };
        o.x = e.x;
        o.y = e.y;
        o.rev += 1;
        this.rebase(o.id, e.prevRev, o.rev);
        return { ok: true, label: e.label, obj: { before, after: o } };
      }
      case "update": {
        const o = maps.objects.get(e.before.id);
        if (!o || o.rev !== e.rev) return stale();
        const before = { ...o };
        const restored: GameObject = { ...e.before, rev: o.rev + 1 };
        if (!isPl(restored.ownerId)) delete restored.ownerId;
        maps.objects.set(o.id, restored);
        this.rebase(o.id, e.prevRev, restored.rev);
        return { ok: true, label: e.label, obj: { before, after: restored } };
      }
      case "remove": {
        if (maps.objects.has(e.obj.id) || !maps.scenes.has(e.obj.sceneId) || maps.objects.size >= maxObjects) return stale();
        // 삭제는 rev를 올리지 않았고, 화면에서는 이미 사라졌으니 같은 rev로 되살려도 된다(앞선 기록과 이어진다).
        const restored: GameObject = { ...e.obj };
        if (!isPl(restored.ownerId)) delete restored.ownerId;
        maps.objects.set(restored.id, restored);
        return { ok: true, label: e.label, obj: { before: null, after: restored } };
      }
      case "fog": {
        const scene = maps.scenes.get(e.sceneId);
        if (!scene?.fog) return stale();
        const fog = scene.fog;
        if (e.cmd === "fog.forget") {
          // 지운 뒤 새로 쌓인 기록은 두고, 지웠던 기록을 되살린다.
          const have = fog.explored ?? [];
          const merged = [...(e.before.explored ?? []), ...have.filter((a) => !(e.before.explored ?? []).some((b) => same(a, b)))];
          fog.explored = merged.slice(-MAX_FOG_EXPLORED);
          if (fog.explored.length === 0) delete fog.explored;
          return { ok: true, label: e.label, scene };
        }
        if (!same(fog.zones, e.after.zones)) return stale();
        fog.zones = clone(e.before.zones);
        // 이 동작으로 늘거나 준 탐험 기록은, 그 뒤 달라지지 않았을 때만 되돌린다.
        if (same(fog.explored, e.after.explored)) {
          if (e.before.explored) fog.explored = clone(e.before.explored);
          else delete fog.explored;
        }
        return { ok: true, label: e.label, scene };
      }
    }
  }
}

export type UndoResult =
  | { ok: false; message: string }
  | { ok: true; label: string; obj?: { before: GameObject | null; after: GameObject | null }; scene?: Scene };
