import { DEFAULT_EFFECTS, DEFAULT_SCENE_ID, type EffectSettings } from "./protocol";
import type { Character } from "./sheet";
import type {
  EndSummary,
  AudioTrack,
  BgmState,
  Flow,
  Initiative,
  MadnessResult,
  GameObject,
  BoardPing,
  Scene,
  Transition,
  Handout,
  Member,
  RollLogEntry,
  RollAsk,
  ServerMessage,
  SessionStatus,
  PauseReason,
} from "./protocol";

/** 클라이언트가 들고 있는 룸 상태. 서버 이벤트를 순서대로 적용해 만든다. */
export interface RoomState {
  ready: boolean;
  roomId: string;
  /** 지금까지 받은 가장 큰 seq. 재접속 때 서버에 알려 준다. */
  lastSeq: number;
  sessionStatus: SessionStatus;
  pauseReason: PauseReason | null;
  /** KP 연결이 끊겨 유예 중인 동안의 끊긴 시각. 아니면 null */
  kpAwaySince: number | null;
  sessionNumber: number;
  objects: Record<string, GameObject>;
  /** KP는 모든 장면, 나머지는 활성 장면만 안다. */
  scenes: Record<string, Scene>;
  activeSceneId: string;
  effects: EffectSettings;
  /** KP만 채워진다. */
  madnessTable: string[];
  initiative: Initiative | null;
  /** KP만 받는다. */
  flow: Flow | null;
  /** KP만 받는다. */
  audioLibrary: AudioTrack[];
  bgm: BgmState | null;
  /** 마지막 배경음 정지의 페이드(ms). 엔진이 이 길이로 줄인다. */
  stopFadeMs: number;
  /** 서버 시계 − 내 시계(ms). 접속할 때 맞춘다. */
  clockOffset: number;
  /** 방금 울릴 효과음. n이 바뀌면 새로 울린다. */
  lastSe: { assetId: string; volume: number; n: number } | null;
  /** 가장 최근 광기 증상 굴림(시트 주인과 KP만 받는다). n은 같은 결과가 또 와도 새로 보이게 하는 번호다. */
  lastMadness: { result: MadnessResult; n: number } | null;
  /** 장면이 바뀔 때마다 n이 오른다. 화면 효과를 다시 재생하는 신호로 쓴다. */
  transition: { kind: Transition; n: number } | null;
  members: Member[];
  rolls: RollLogEntry[];
  /** KP가 요청한 판정(최근 것부터 5개). 화면에서 내게 온 것만 골라 쓴다. */
  rollAsks: RollAsk[];
  characters: Record<string, Character>;
  handouts: Record<string, Handout>;
  /** KP가 "바로 펼치기"를 눌렀을 때 화면에 띄울 핸드아웃. n이 바뀌면 같은 핸드아웃도 다시 띄운다. */
  spotlight: { id: string; n: number } | null;
  /** 다른 사람의 비밀 굴림 알림("KP가 비밀 굴림을 했어요") */
  /** 마지막 세션 종료 정산. 다음 세션이 시작되면 지운다. */
  lastEnd: EndSummary | null;
  hiddenRolls: Array<{ id: string; userName: string; at: number }>;
  /** 최근 핑(최대 MAX_PINGS개). 화면이 몇 초 보여 주고 지운다. */
  pings: BoardPing[];
  lastError: { code: string; message: string; requestId?: string } | null;
  /** 마지막으로 되돌린 동작. n이 바뀌면 새 되돌림이다. */
  lastUndo: { n: number; label: string } | null;
}

export const initialRoomState = (roomId = ""): RoomState => ({
  ready: false,
  roomId,
  lastSeq: 0,
  sessionStatus: "IDLE",
  pauseReason: null,
  kpAwaySince: null,
  sessionNumber: 0,
  objects: {},
  scenes: {},
  activeSceneId: DEFAULT_SCENE_ID,
  effects: DEFAULT_EFFECTS,
  madnessTable: [],
  initiative: null,
  flow: null,
  audioLibrary: [],
  bgm: null,
  stopFadeMs: 600,
  clockOffset: 0,
  lastSe: null,
  lastMadness: null,
  transition: null,
  members: [],
  rolls: [],
  rollAsks: [],
  characters: {},
  handouts: {},
  spotlight: null,
  hiddenRolls: [],
  pings: [],
  lastEnd: null,
  lastError: null,
  lastUndo: null,
});

const MAX_ROLLS = 200;
const MAX_PINGS = 8;

/** 서버 메시지 하나를 적용해 새 상태를 돌려준다. 같은 이벤트를 두 번 받아도 결과가 같다. */
export function applyServerMessage(state: RoomState, msg: ServerMessage): RoomState {
  const ev = msg.event;
  if (ev.type === "snapshot") {
    const d = ev.data;
    return {
      ...state,
      ready: true,
      roomId: d.roomId,
      lastSeq: d.seq,
      sessionStatus: d.sessionStatus,
      pauseReason: d.pauseReason ?? null,
      kpAwaySince: d.kpAwaySince ?? null,
      sessionNumber: d.sessionNumber,
      objects: Object.fromEntries(d.objects.map((o) => [o.id, o])),
      scenes: Object.fromEntries(d.scenes.map((sc) => [sc.id, sc])),
      activeSceneId: d.activeSceneId,
      effects: d.effects,
      madnessTable: d.madnessTable,
      initiative: d.initiative ?? null,
      flow: d.flow ?? null,
      audioLibrary: d.audioLibrary ?? [],
      bgm: d.bgm ?? null,
      stopFadeMs: 600,
      clockOffset: (d.now ?? Date.now()) - Date.now(),
      lastSe: null,
      lastMadness: null,
      transition: null,
      members: d.members,
      rolls: d.rolls,
      rollAsks: [],
      characters: Object.fromEntries(d.characters.map((c) => [c.id, c])),
      handouts: Object.fromEntries(d.handouts.map((h) => [h.id, h])),
      spotlight: null,
      hiddenRolls: [],
      pings: [],
      lastEnd: null,
      lastError: null,
    };
  }
  if (ev.type === "error") {
    return { ...state, lastError: ev.data };
  }

  const next: RoomState = { ...state, lastSeq: Math.max(state.lastSeq, msg.seq) };
  switch (ev.type) {
    case "object.added":
    case "object.updated": {
      const cur = state.objects[ev.data.id];
      // 이미 더 새로운 rev를 갖고 있으면 오래된 이벤트로 덮어쓰지 않는다.
      if (cur && cur.rev > ev.data.rev) return next;
      return { ...next, objects: { ...state.objects, [ev.data.id]: ev.data } };
    }
    case "object.removed": {
      const { [ev.data.id]: _gone, ...rest } = state.objects;
      return { ...next, objects: rest };
    }
    case "board.pinged":
      if (state.pings.some((p) => p.id === ev.data.id)) return next;
      return { ...next, pings: [...state.pings, ev.data].slice(-MAX_PINGS) };
    case "audio.library":
      return { ...next, audioLibrary: ev.data.tracks };
    case "audio.play":
      if (ev.data.channel === "bgm") return { ...next, bgm: { assetId: ev.data.assetId, volume: ev.data.volume, startedAt: ev.data.startedAt, fadeMs: ev.data.fadeMs } };
      return { ...next, lastSe: { assetId: ev.data.assetId, volume: ev.data.volume, n: msg.seq } };
    case "audio.stopped":
      return { ...next, bgm: null, stopFadeMs: ev.data.fadeMs };
    case "audio.volume":
      return { ...next, bgm: next.bgm ? { ...next.bgm, volume: ev.data.volume } : null };
    case "flow.updated":
      return { ...next, flow: ev.data.flow };
    case "initiative.updated":
      return { ...next, initiative: ev.data.initiative };
    case "settings.madness":
      return { ...next, madnessTable: ev.data.entries };
    case "madness.result":
      return { ...next, lastMadness: { result: ev.data, n: msg.seq } };
    case "settings.effects":
      return { ...next, effects: ev.data.effects };
    case "scene.added":
    case "scene.updated":
      return { ...next, scenes: { ...state.scenes, [ev.data.id]: ev.data } };
    case "scene.removed": {
      const { [ev.data.id]: _gone, ...rest } = state.scenes;
      const objects = Object.fromEntries(Object.entries(state.objects).filter(([, o]) => o.sceneId !== ev.data.id));
      return { ...next, scenes: rest, objects };
    }
    case "scene.activated": {
      const { scene, transition, objects } = ev.data;
      const base = { ...next, activeSceneId: scene.id, transition: { kind: transition, n: (state.transition?.n ?? 0) + 1 } };
      // 오브젝트 목록이 같이 오면(KP 외) 통째로 바꾸고, 알려진 장면도 이것 하나로 맞춘다.
      if (objects) return { ...base, objects: Object.fromEntries(objects.map((o) => [o.id, o])), scenes: { [scene.id]: scene } };
      return { ...base, scenes: { ...state.scenes, [scene.id]: scene } };
    }
    case "handout.added":
    case "handout.updated": {
      const cur = state.handouts[ev.data.id];
      if (cur && cur.rev > ev.data.rev) return next;
      return { ...next, handouts: { ...state.handouts, [ev.data.id]: ev.data } };
    }
    case "handout.removed": {
      const { [ev.data.id]: _gone, ...rest } = state.handouts;
      return { ...next, handouts: rest, spotlight: state.spotlight?.id === ev.data.id ? null : state.spotlight };
    }
    case "undo.done":
      return { ...next, lastUndo: { n: (state.lastUndo?.n ?? 0) + 1, label: ev.data.label } };
    case "handout.shown":
      return { ...next, spotlight: { id: ev.data.id, n: (state.spotlight?.n ?? 0) + 1 } };
    case "character.added":
    case "character.updated": {
      const cur = state.characters[ev.data.id];
      if (cur && cur.rev > ev.data.rev) return next;
      return { ...next, characters: { ...state.characters, [ev.data.id]: ev.data } };
    }
    case "character.removed": {
      const { [ev.data.id]: _gone, ...rest } = state.characters;
      return { ...next, characters: rest };
    }
    case "roll.result": {
      if (state.rolls.some((r) => r.id === ev.data.id)) return next;
      return { ...next, rolls: [...state.rolls, ev.data].slice(-MAX_ROLLS) };
    }
    case "roll.asked": {
      if (state.rollAsks.some((a) => a.id === ev.data.id)) return next;
      return { ...next, rollAsks: [...state.rollAsks, ev.data].slice(-5) };
    }
    case "roll.hidden": {
      if (state.hiddenRolls.some((r) => r.id === ev.data.id)) return next;
      return {
        ...next,
        hiddenRolls: [...state.hiddenRolls, { id: ev.data.id, userName: ev.data.userName, at: ev.data.at }].slice(-50),
      };
    }
    case "presence":
      return { ...next, members: ev.data.members };
    case "session.started":
      return { ...next, sessionStatus: "ACTIVE", pauseReason: null, kpAwaySince: null, sessionNumber: ev.data.number, lastEnd: null };
    case "session.paused":
      return { ...next, sessionStatus: "PAUSED", pauseReason: ev.data.reason, kpAwaySince: null };
    case "session.resumed":
      return { ...next, sessionStatus: "ACTIVE", pauseReason: null, kpAwaySince: null };
    case "kp.away":
      return { ...next, kpAwaySince: ev.data.since };
    case "kp.back":
      return { ...next, kpAwaySince: null };
    case "session.ended":
      return { ...next, sessionStatus: "IDLE", pauseReason: null, kpAwaySince: null, lastEnd: ev.data };
  }
}
