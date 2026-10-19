import { CHAT_KEEP, DEFAULT_CHAT_SETTINGS, DEFAULT_EFFECTS, DEFAULT_SCENE_ID, type ChatMessage, type ChatSettings, type EffectSettings } from "./protocol";
import { mergeChat } from "./chat";
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
  DamageApplied,
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
  /** GM 연결이 끊겨 유예 중인 동안의 끊긴 시각. 아니면 null */
  kpAwaySince: number | null;
  sessionNumber: number;
  objects: Record<string, GameObject>;
  /** GM은 모든 장면, 나머지는 활성 장면만 안다. */
  scenes: Record<string, Scene>;
  activeSceneId: string;
  effects: EffectSettings;
  /** GM만 채워진다. */
  madnessTable: string[];
  initiative: Initiative | null;
  /** GM만 받는다. */
  flow: Flow | null;
  /** GM만 받는다. */
  audioLibrary: AudioTrack[];
  bgm: BgmState | null;
  /** 마지막 배경음 정지의 페이드(ms). 엔진이 이 길이로 줄인다. */
  stopFadeMs: number;
  /** 서버 시계 − 내 시계(ms). 접속할 때 맞춘다. */
  clockOffset: number;
  /** 방금 울릴 효과음. n이 바뀌면 새로 울린다. */
  lastSe: { assetId: string; volume: number; n: number; startedAt: number } | null;
  /** 가장 최근 광기 증상 굴림(시트 주인과 GM만 받는다). n은 같은 결과가 또 와도 새로 보이게 하는 번호다. */
  lastMadness: { result: MadnessResult; n: number } | null;
  /** 장면이 바뀔 때마다 n이 오른다. 화면 효과를 다시 재생하는 신호로 쓴다. */
  transition: { kind: Transition; n: number } | null;
  members: Member[];
  rolls: RollLogEntry[];
  /** 내가 볼 수 있는 대화(오래된 순, 최근 CHAT_KEEP개). 접속하면 최근 대화가 나뉘어 도착한다. */
  chat: ChatMessage[];
  /** 접속 직후의 최근 대화를 다 받았는가(옛 서버에는 없는 이벤트라 snapshot에서 false로 시작한다) */
  chatLoaded: boolean;
  chatSettings: ChatSettings;
  /** GM이 요청한 판정(최근 것부터 5개). 화면에서 내게 온 것만 골라 쓴다. */
  rollAsks: RollAsk[];
  characters: Record<string, Character>;
  handouts: Record<string, Handout>;
  /** GM이 "바로 펼치기"를 눌렀을 때 화면에 띄울 핸드아웃. n이 바뀌면 같은 핸드아웃도 다시 띄운다. */
  spotlight: { id: string; n: number } | null;
  /** 펼쳐 보인 횟수. 핸드아웃이 사라지거나 다시 접속해도 줄지 않아서, 화면이 닫은 번호(n)와 새 펼치기를 헷갈리지 않는다. */
  spotlightSeq: number;
  /** 이미 적용한 피해: 굴림 id → 적용한 캐릭터 id들(GM 화면의 "적용됨" 표시) */
  damageApplied: Record<string, string[]>;
  /** 가장 최근 피해 적용 결과(시트 주인과 GM). n이 바뀌면 새 결과다. */
  lastDamage: { n: number; result: DamageApplied } | null;
  /** 다른 사람의 비밀 굴림 알림("GM이 비밀 굴림을 했어요") */
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
  chat: [],
  chatLoaded: false,
  chatSettings: DEFAULT_CHAT_SETTINGS,
  rollAsks: [],
  characters: {},
  handouts: {},
  spotlight: null,
  spotlightSeq: 0,
  hiddenRolls: [],
  damageApplied: {},
  lastDamage: null,
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
      // 대화는 이어서 둔다(다시 접속하면 같은 대화가 또 오지만 id로 걸러진다).
      chatLoaded: false,
      chatSettings: d.chatSettings ?? DEFAULT_CHAT_SETTINGS,
      rollAsks: [],
      characters: Object.fromEntries(d.characters.map((c) => [c.id, c])),
      handouts: Object.fromEntries(d.handouts.map((h) => [h.id, h])),
      spotlight: null,
      spotlightSeq: state.spotlightSeq,
      hiddenRolls: [],
      damageApplied: d.damageApplied ?? {},
      lastDamage: null,
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
      return { ...next, lastSe: { assetId: ev.data.assetId, volume: ev.data.volume, n: msg.seq, startedAt: ev.data.startedAt } };
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
    case "scene.order": {
      // 알려진 장면을 새 순서로 다시 세운다(모르는 id는 건너뛰고, 목록에 없는 장면은 뒤에 둔다).
      const ordered: Record<string, Scene> = {};
      for (const id of ev.data.ids) if (state.scenes[id]) ordered[id] = state.scenes[id]!;
      for (const [id, sc] of Object.entries(state.scenes)) if (!ordered[id]) ordered[id] = sc;
      return { ...next, scenes: ordered };
    }
    case "scene.activated": {
      const { scene, transition, objects } = ev.data;
      const base = { ...next, activeSceneId: scene.id, transition: { kind: transition, n: (state.transition?.n ?? 0) + 1 } };
      // 오브젝트 목록이 같이 오면(GM 외) 통째로 바꾸고, 알려진 장면도 이것 하나로 맞춘다.
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
      return { ...next, spotlight: { id: ev.data.id, n: state.spotlightSeq + 1 }, spotlightSeq: state.spotlightSeq + 1 };
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
    case "damage.applied": {
      const r = ev.data;
      const prev = r.rollId ? (state.damageApplied[r.rollId] ?? []) : [];
      const applied = r.rollId && !prev.includes(r.characterId) ? { ...state.damageApplied, [r.rollId]: [...prev, r.characterId] } : state.damageApplied;
      return { ...next, damageApplied: applied, lastDamage: { n: msg.seq, result: r } };
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
    case "chat.posted":
      return { ...next, chat: mergeChat(state.chat, [ev.data], CHAT_KEEP) };
    case "chat.history":
      return { ...next, chat: mergeChat(state.chat, ev.data.messages, CHAT_KEEP), chatLoaded: state.chatLoaded || ev.data.last };
    case "settings.chat":
      return { ...next, chatSettings: ev.data };
    case "presence":
      return { ...next, members: ev.data.members };
    case "member.removed":
      // 연결이 곧 4410으로 닫힌다. 화면은 닫힘 코드로 안내한다.
      return next;
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
