"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { countsLine, type GameObject, type Role } from "@coc-vtt/shared";
import { SheetCsvImport } from "@/entities/character";
import { beginDiscordLogin, refreshStoredSession, useIdentity, type Identity } from "@/entities/user";
import { getChatPage, getRoom, type ScenarioImportResult } from "@/entities/room";
import { SERVICE_NAME, SUPABASE_URL } from "@/shared/config";
import { roomTitle, useDocumentTitle, usePhone } from "@/shared/lib";
import { MarkerButton, ObjectToolbar, PlaceControls, QuickTokenButton, SelectedControls, canEditMarkers, uniqueName, useBoardInteractions, usePlacement } from "@/features/board-objects";
import { ShortcutHelp, useShortcutHelp } from "@/features/shortcut-help";
import { FogToolbar } from "@/features/manage-fog";
import { Hint, ImageLibraryProvider, onTabListKeyDown, roomImageIds, useImageLibraryStore } from "@/shared/ui";
import { SceneBar } from "@/features/manage-scenes";
import { importedText } from "@/features/scenario-prep";
import { StageCues } from "@/features/stage-cues";
import { useEffectPreference } from "@/features/effect-preference";
import { SoundBlockedHint, SoundControl, useAudioEngine, useAudioPreference } from "@/features/audio-playback";
import { LoadCharacter } from "@/features/load-character";
import { NpcSheetButton } from "@/features/npc-sheet";
import { useRoom } from "@/features/room-realtime";
import { UndoButton, useUndo } from "@/features/undo-last";
import { ConnectionBanner, MyTurnBadge, Toasts, findTurnTokens, isMyTurn, offTurnNotice, useRoomNotices, useUnseen } from "@/features/room-notices";
import { MadnessResultCard } from "@/features/manage-madness";
import { EndSummaryCard } from "@/features/session-control";
import { SaveToVaultButton } from "@/features/save-to-vault";
import { useChatUnread } from "@/features/chat-unread";
import { AudioPanel } from "@/widgets/audio-panel";
import { ChatPanel } from "@/widgets/chat-panel";
import { LogPanel } from "@/widgets/log-panel";
import { Board, snapKey, viewKey } from "@/widgets/board";
import { HandoutPanel } from "@/widgets/handout-panel";
import { FlowPanel } from "@/widgets/flow-panel";
import { InitiativePanel } from "@/widgets/initiative-panel";
import { HandoutSpotlight } from "@/widgets/handout-spotlight";
import { RollEffect } from "@/widgets/roll-effect";
import { AskBanner, ConBanner, RollPanel } from "@/widgets/roll-panel";
import { SceneTransition, useSceneFade } from "@/widgets/scene-transition";
import { SanEffect } from "@/widgets/san-effect";
import { RoomHeader } from "@/widgets/room-header";
import { StartGuide } from "./StartGuide";
import { PlayerGuide } from "./PlayerGuide";
import { pauseNotice } from "../model/pause-notice";
import { rollBlockReason } from "../model/roll-reason";
import { rollToastText, shouldToastRoll } from "../model/roll-toast";
import { damageToastText } from "../model/damage-toast";
import { playerGuideSteps, readGuideClosed, showPlayerGuide, writeGuideClosed } from "../model/player-guide";
import { SheetPanel, SheetEmpty, type RollOptions } from "@/widgets/sheet-panel";
import { RoomCharacterCreate } from "@/widgets/character-creator";
import { PanelDock, ToolSheet } from "@/widgets/phone-bars";
import { INITIAL_PANELS, panelsReducer, selectLabel, type SheetTab } from "../model/phone-panels";

const REJECTED: Record<number, string> = {
  4401: "로그인 정보가 올바르지 않아요.",
  4403: "이 룸에 들어갈 수 없어요. 초대 링크가 없거나 만료됐어요. GM에게 새 링크를 받아 주세요.",
  4404: "룸을 찾을 수 없어요. 룸을 만든 사람이 지웠을 수 있어요.",
  4409: "룸 인원이 가득 찼어요.",
  4410: "GM이 관전에서 내보냈어요. 다시 들어오려면 GM에게 관전 링크를 받아 주세요.",
};

export function RoomView({ roomId, invite }: { roomId: string; invite?: string }) {
  const router = useRouter();
  const { identity } = useIdentity();
  useEffect(() => {
    if (identity === null) router.replace(invite ? `/join/${roomId}?invite=${encodeURIComponent(invite)}` : "/");
  }, [identity, invite, roomId, router]);
  if (!identity) return null;
  return <Room roomId={roomId} me={identity} invite={invite} />;
}

function Room({ roomId, me, invite }: { roomId: string; me: Identity; invite?: string }) {
  const { state, connection, closeCode, send, retry, reconnected, sendFailed, authExpired, addChatHistory } = useRoom({ roomId, user: me.userId, name: me.name, token: me.token, invite, refresh: me.token && SUPABASE_URL ? refreshStoredSession : undefined });
  const sheetRollAt = useRef(0); // 시트에서 굴린 시각. 그 결과를 토스트로 보여 준다.
  const notices = useRoomNotices({ lastError: state.lastError, sendFailed, reconnected, lastUndo: state.lastUndo });
  const { undo, sendWithHint } = useUndo({ enabled: (state.members.find((m) => m.userId === me.userId)?.role ?? "pl") === "kp", send, notify: notices.notify });
  const [guideClosed, setGuideClosed] = useState(false);
  const [plGuideClosed, setPlGuideClosed] = useState(false);
  useEffect(() => setPlGuideClosed(readGuideClosed(roomId)), [roomId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fx = useEffectPreference();
  // 재접속한 시각. 그 직후 다시 받은 장면 전환은 연출하지 않는다.
  const reconnectedAt = useRef(0);
  useEffect(() => {
    if (reconnected > 0) reconnectedAt.current = Date.now();
  }, [reconnected]);
  const sound = useAudioPreference();
  const [tab, setTab] = useState<"roll" | "chat" | "sheet" | "handout" | "combat" | "flow" | "sound" | "log">("roll");
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [dismissedN, setDismissedN] = useState(0);
  const [viewSceneId, setViewSceneId] = useState<string | null>(null);
  const [fogPicking, setFogPicking] = useState(false);
  const [fogRadius, setFogRadius] = useState(120);
  const [panelOpen, setPanelOpen] = useState(true); // 태블릿·데스크톱: 패널 접기(지금은 휴대폰이 아니면 항상 펴 둔다)
  // 휴대폰(<=640px): 아래 도구 시트(GM)와 패널 서랍. 같은 자리를 쓰므로 한쪽을 펴면 다른 쪽은 접는다.
  const phone = usePhone();
  const [panels, dispatchPanels] = useReducer(panelsReducer, INITIAL_PANELS);
  const drawerOpener = useRef<HTMLElement | null>(null);
  const shortcutHelp = useShortcutHelp();
  // 탭 제목에 룸 이름을 넣는다. 이름을 못 가져와도 룸은 그대로 쓸 수 있다.
  const [roomName, setRoomName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getRoom(me, roomId, invite).then((r) => alive && setRoomName(r.name)).catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, invite, me.userId]);
  useDocumentTitle(roomName ? roomTitle(roomName, SERVICE_NAME) : null);

  // 역할은 서버가 확정한 값을 쓴다. 접속 전에는 PL로 임시 표시한다.
  const role: Role = state.members.find((m) => m.userId === me.userId)?.role ?? "pl";
  const isKp = role === "kp";
  const active = state.sessionStatus === "ACTIVE";
  // 세션 전(준비 모드)에는 GM도 보드를 만질 수 있다.
  // 일시정지 중에도 GM은 준비성 편집(토큰·소품·안개·장면·시트·핸드아웃·흐름·음향)을 할 수 있다.
  // 판정·전투·장면 전환처럼 이야기를 앞으로 미는 것만 이어하기 뒤에 한다(서버가 같은 규칙으로 막는다).
  const paused = state.sessionStatus === "PAUSED";
  const canEditBoard = active || isKp;
  const kpAway = active && !isKp && state.kpAwaySince !== null;
  const scenes = useMemo(() => Object.values(state.scenes), [state.scenes]);
  // GM은 활성이 아닌 장면도 골라 꾸밀 수 있고, 장면이 사라지면 활성 장면으로 돌아온다.
  // 비트나 단축키로 진행 장면이 바뀌면 GM 화면도 그 장면을 따라간다.
  useEffect(() => setViewSceneId(null), [state.activeSceneId]);
  const shownSceneId = isKp && viewSceneId && state.scenes[viewSceneId] ? viewSceneId : state.activeSceneId;
  const objects = useMemo(() => Object.values(state.objects).filter((o) => o.sceneId === shownSceneId), [state.objects, shownSceneId]);
  const characters = useMemo(() => Object.values(state.characters), [state.characters]);
  const sheet = characters.find((c) => c.id === sheetId) ?? characters[0];
  // GM에게 보이는 시트 중 PL의 것이 아닌 것이 NPC 시트다(서버는 PL에게 NPC 시트를 보내지 않는다).
  const npcIds = useMemo(() => {
    const pls = new Set(state.members.filter((m) => m.role === "pl").map((m) => m.userId));
    return new Set(isKp ? characters.filter((c) => !pls.has(c.ownerId)).map((c) => c.id) : []);
  }, [isKp, characters, state.members]);
  const hasToken = Object.values(state.objects).some((o) => o.kind === "token" && o.ownerId === me.userId);
  const hasOwn = characters.some((c) => c.ownerId === me.userId);
  const spot = state.spotlight && state.spotlight.n > dismissedN ? state.handouts[state.spotlight.id] : undefined;
  const handoutList = useMemo(() => Object.values(state.handouts), [state.handouts]);
  const cueSource = useMemo(() => ({ scenes, activeSceneId: state.activeSceneId, handouts: handoutList, objects }), [scenes, state.activeSceneId, handoutList, objects]);
  const endBeat = state.flow?.beats.find((b) => b.id === state.flow?.current && b.kind === "ending");
  const endingDefaults = endBeat ? { name: endBeat.name, ...(endBeat.sanReward ? { sanReward: endBeat.sanReward } : {}) } : undefined;
  const selected = selectedId ? state.objects[selectedId] : undefined;
  // 안개: GM은 설정(밝힌 영역 + 시야 토큰)으로 미리 보고, 나머지는 서버가 알려 준 지금 보이는 원들을 쓴다.
  const shownScene = state.scenes[shownSceneId];
  const fogView = useMemo(() => {
    if (isKp) {
      if (!shownScene?.fog?.enabled) return undefined;
      const areas = [...shownScene.fog.zones.map((z) => ({ x: z.x, y: z.y, r: z.r })), ...objects.filter((o) => o.vision).map((o) => ({ x: o.x, y: o.y, r: o.vision! }))];
      return { areas, preview: true, explored: shownScene.fog.explored };
    }
    return shownScene?.fogAreas ? { areas: shownScene.fogAreas, preview: false, explored: shownScene.fogExplored } : undefined;
  }, [isKp, shownScene, objects]);
  // 페이드 전환: 어두워지는 동안은 이전 장면의 보드를 붙잡고, 다 어두워지면 새 장면으로 바꾼다.
  const liveBoard = useMemo(() => ({ sceneId: shownSceneId, objects, background: shownScene?.background, grid: shownScene?.grid, fog: fogView, name: state.scenes[state.activeSceneId]?.name }), [shownSceneId, objects, shownScene, fogView, state.scenes, state.activeSceneId]);
  const { shown: board, fade } = useSceneFade(liveBoard, state.transition, reconnectedAt.current, fx.enabled);
  const lastRoll = state.rolls.at(-1);
  useEffect(() => {
    if (!lastRoll || !shouldToastRoll(sheetRollAt.current, Date.now(), lastRoll.userId, me.userId)) return;
    sheetRollAt.current = 0;
    notices.notify(rollToastText(lastRoll));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRoll?.id]);
  // GM이 피해를 적용하면 시트 주인과 GM에게 결과를 한 줄로 알린다.
  const lastDamage = state.lastDamage;
  useEffect(() => {
    if (lastDamage) notices.notify(damageToastText(lastDamage.result));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDamage?.n]);
  const audio = useAudioEngine({ bgm: state.bgm, stopFadeMs: state.stopFadeMs, lastSe: state.lastSe, clockOffset: state.clockOffset, lastRollId: state.rolls.at(-1)?.id ?? null, lastRollAt: state.rolls.at(-1)?.at ?? null, ready: state.ready, prefs: sound.prefs });

  const handoutIds = useMemo(() => handoutList.map((h) => h.id), [handoutList]);
  // 새로 받은 핸드아웃(PL만). 핸드아웃 탭을 보고 있으면 본 것으로 친다.
  const newHandouts = useUnseen(handoutIds, { ready: state.ready, viewing: tab === "handout", enabled: !isKp });
  const panelVisible = phone ? panels.drawerOpen : panelOpen;
  const chatUnread = useChatUnread(state.chat, { ready: state.ready && state.chatLoaded, viewing: tab === "chat" && panelVisible, meId: me.userId });
  const speakable = useMemo(() => characters.filter((c) => (isKp ? npcIds.has(c.id) : c.ownerId === me.userId)).map((c) => ({ id: c.id, name: c.name })), [characters, isKp, npcIds, me.userId]);
  const loadOlderChat = async (before: number) => {
    const page = await getChatPage(me, roomId, before, 50);
    addChatHistory(page.messages);
    return page.hasMore;
  };
  const logVersion = `${state.rolls.length}:${state.chat.at(-1)?.seq ?? 0}:${state.sessionStatus}:${state.sessionNumber}:${state.activeSceneId}:${state.initiative?.round ?? 0}:${state.flow?.current ?? ""}:${handoutList.length}`;
  const myTurn = isMyTurn(state.initiative, characters, me.userId);
  // 전투 중 지금 차례인 PL의 토큰들(칸 → 캐릭터 주인 → 그 PL의 토큰). 연결이 없으면 빈 목록이라 강조하지 않는다.
  const turnTokenIds = useMemo(() => findTurnTokens(state.initiative, characters, objects), [state.initiative, characters, objects]);
  const lastOffTurn = useRef<string | null>(null); // 같은 차례에는 안내를 한 번만
  const lastPing = useRef(0);
  const canPing = role !== "spectator" && canEditBoard && shownSceneId === state.activeSceneId;

  // 이미지 고르기 목록: 이 룸에서 이미 쓴 이미지(배경·토큰·핸드아웃)와 내가 올린 이미지
  const usedImages = useMemo(() => roomImageIds({ scenes, objects: Object.values(state.objects), handouts: handoutList }), [scenes, state.objects, handoutList]);
  const library = useImageLibraryStore(roomId, usedImages);
  // 키보드(지우기·복제·선택 이동), 오른쪽 클릭 메뉴, 이미지 끌어놓기·붙여넣기
  const interactions = useBoardInteractions({ me, isKp, sceneId: shownSceneId, objects, selectedId, onSelect: setSelectedId, send: sendWithHint, notify: notices.notify, remember: library.remember });
  const players = useMemo(() => state.members.filter((m) => m.role === "pl"), [state.members]);
  const placement = usePlacement({ sceneId: shownSceneId, objects, players, send: sendWithHint });

  // 방금 만든 NPC 시트를 열고, 원하면 시트를 이은 토큰도 놓는다(새로 생긴 시트의 id는 서버가 정해서 도착한 뒤에야 안다).
  const npcPending = useRef<{ before: Set<string>; place: boolean } | null>(null);
  useEffect(() => {
    const p = npcPending.current;
    if (!p) return;
    const added = characters.find((c) => !p.before.has(c.id));
    if (!added) return;
    npcPending.current = null;
    setSheetId(added.id);
    setTab("sheet");
    if (p.place) send({ type: "object.add", data: { kind: "token", name: uniqueName(added.name, objects.map((o) => o.name)), x: 500, y: 400, layer: "object", visibleTo: "all", sceneId: shownSceneId, autoPlace: true, characterId: added.id } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters]);
  /** 패널을 그 탭으로 연다. 휴대폰에서는 서랍이 열린다. */
  const showTab = (t: typeof tab) => {
    setTab(t);
    setPanelOpen(true);
    if (phone) {
      drawerOpener.current = (document.activeElement as HTMLElement | null) ?? null;
      dispatchPanels({ type: "drawer.open" });
    }
  };
  const openSheet = (characterId: string) => {
    setSheetId(characterId);
    showTab("sheet");
  };
  // 휴대폰이 아니게 되면(화면을 돌리거나 키우면) 서랍·시트를 접어 둔다. 고른 것이 없어지면 선택 묶음에서 나온다.
  useEffect(() => {
    if (phone) return;
    dispatchPanels({ type: "escape" });
    dispatchPanels({ type: "escape" });
  }, [phone]);
  useEffect(() => {
    if (!selectedId) dispatchPanels({ type: "selection.cleared" });
  }, [selectedId]);
  // Esc: 서랍을 먼저, 그다음 시트를 닫는다(대화상자·메뉴가 열려 있으면 그쪽이 먼저 쓴다).
  useEffect(() => {
    if (!phone || (!panels.drawerOpen && !panels.sheetOpen)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector('[role="dialog"],[role="menu"],[aria-modal="true"]')) return;
      dispatchPanels({ type: "escape" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phone, panels.drawerOpen, panels.sheetOpen]);
  const closeDrawer = () => {
    dispatchPanels({ type: "drawer.close" });
    drawerOpener.current?.focus?.();
  };
  // 지도 위에 얹는 것들이 장면 막대·아래 줄을 피하도록, 두 높이를 CSS 변수로 알린다(--sb-h: 장면 막대, --dock-h: 휴대폰 아래 줄).
  const roomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = roomRef.current;
    if (!el) return;
    const bars: Array<[string, HTMLElement | null]> = [
      ["--sb-h", el.querySelector<HTMLElement>(".scenebar")],
      ...(phone ? ([["--dock-h", el.querySelector<HTMLElement>(".toolsheet, .panel-dock")]] as Array<[string, HTMLElement | null]>) : []),
    ];
    const set = () => {
      for (const [name, bar] of bars) el.style.setProperty(name, `${bar ? Math.round(bar.getBoundingClientRect().height) : 0}px`);
    };
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    for (const [, bar] of bars) if (bar) ro.observe(bar);
    return () => ro.disconnect();
  }, [phone, isKp, role]);

  if (authExpired) {
    return (
      <main className="login">
        <div className="err" role="alert">로그인이 만료됐어요. 다시 로그인해 주세요.</div>
        <button className="btn primary" onClick={beginDiscordLogin}>디스코드로 다시 로그인</button>
        <Link className="btn" href="/">로비로</Link>
      </main>
    );
  }

  if (closeCode !== null && REJECTED[closeCode]) {
    return (
      <main className="login">
        <div className="err" role="alert">{REJECTED[closeCode]}</div>
        <Link className="btn" href="/">로비로</Link>
      </main>
    );
  }

  // 가져온 직후 토스트의 "되돌리기"로 방금 가져온 것을 지운다(서버가 기억하는 마지막 가져오기만 되돌릴 수 있다).
  const onImported = (r: ScenarioImportResult) => {
    notices.notify(importedText(countsLine(r.counts), r.warnings.length), { label: "되돌리기", run: () => send({ type: "scenario.revert", data: { importId: r.importId } }) });
  };
  const ping = (x: number, y: number) => {
    const t = Date.now();
    if (t - lastPing.current < 600) return; // 서버 제한(초당 2회)에 걸리지 않게 화면에서 먼저 거른다
    lastPing.current = t;
    send({ type: "board.ping", data: { sceneId: shownSceneId, x, y } });
  };
  const onDragStart = (o: GameObject) => {
    if (role !== "pl") return;
    const n = offTurnNotice(state.initiative, characters, me.userId, o.id, turnTokenIds);
    if (!n || lastOffTurn.current === n.turnKey) return;
    lastOffTurn.current = n.turnKey;
    notices.notify(n.text);
  };
  const move = (o: GameObject, x: number, y: number) => send({ type: "object.move", data: { id: o.id, x, y, rev: o.rev } });

  return (
    <ImageLibraryProvider value={library}>
    <div className={`room${phone ? " phone" : ""}`} ref={roomRef}>
      <a
        href="#game-board"
        className="skip-link"
        data-testid="skip-to-board"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("game-board")?.focus();
        }}
      >
        보드로 건너뛰기
      </a>
      <RoomHeader onShortcutHelp={shortcutHelp.show} me={me} roomId={roomId} roomName={roomName ?? ""} onRenamed={(n) => { setRoomName(n); notices.notify("룸 이름을 바꿨어요."); }} notify={notices.notify} onImported={onImported} role={role} status={state.sessionStatus} kpAway={kpAway} sessionNumber={state.sessionNumber} connection={connection} members={state.members} effects={state.effects} madnessTable={state.madnessTable} endingDefaults={endingDefaults} effectsEnabled={fx.enabled} onToggleEffects={fx.toggle} soundControl={<SoundControl prefs={sound.prefs} onChange={sound.update} unlocked={audio.unlocked} onUnlock={audio.unlock} playing={audio.playing} />} soundHint={<SoundBlockedHint blocked={audio.blocked} onUnlock={audio.unlock} />} send={send} />

      <Toasts toasts={notices.toasts} onDismiss={notices.dismiss} />
      <EndSummaryCard summary={state.lastEnd} />
      <MadnessResultCard last={state.lastMadness} />

      <SanEffect rolls={state.rolls} ready={state.ready} enabled={fx.enabled} />
      <RollEffect rolls={state.rolls} ready={state.ready} effects={state.effects} enabled={fx.enabled} />
      {spot && <HandoutSpotlight handout={spot} onClose={() => setDismissedN(state.spotlight?.n ?? 0)} />}

      <ConnectionBanner connection={connection} retry={retry} />

      <div className="body">
        <main className="board">
          {kpAway && <div className="banner" role="status" data-testid="kp-away-banner">GM 연결이 끊겼어요. 잠시 기다려요.</div>}
          {paused && <div className="banner" role="status" data-testid="pause-banner">{pauseNotice(role, state.pauseReason)}</div>}
          {role === "pl" && <AskBanner asks={state.rollAsks} userId={me.userId} canRoll={active} hasCharacter={characters.some((c) => c.ownerId === me.userId)} onRoll={(name, difficulty) => { const mine = characters.find((c) => c.ownerId === me.userId); if (!mine) return; send({ type: "roll.request", data: { secret: false, skill: { characterId: mine.id, name, bonus: 0, ...(difficulty ? { difficulty } : {}) } } }); setTab("roll"); }} />}
          {role !== "spectator" && <ConBanner last={state.lastDamage} characters={characters} canRoll={active} onRoll={(characterId) => { if (send({ type: "roll.request", data: { secret: false, skill: { characterId, name: "CON", bonus: 0 } } }) !== false) sheetRollAt.current = Date.now(); }} />}
          {myTurn && state.initiative && <MyTurnBadge round={state.initiative.round} lowered={isKp} onOpen={() => showTab("combat")} />}
          {state.sessionStatus === "IDLE" && !isKp && (
            <div className="banner" role="status">GM이 세션을 시작하기를 기다리고 있어요.</div>
          )}
          {showPlayerGuide({ role, ready: state.ready, sessionStatus: state.sessionStatus, closed: plGuideClosed }) && (
            <PlayerGuide spectator={role === "spectator"} steps={playerGuideSteps({ role, userId: me.userId, characters, rolls: state.rolls, handouts: handoutList, hasToken })} onClose={() => { setPlGuideClosed(true); writeGuideClosed(roomId); }} />
          )}
          {state.sessionStatus === "IDLE" && isKp && !guideClosed && (
            <StartGuide
              steps={[
                { done: Boolean(shownScene?.background), title: "장면 꾸미기", hint: "위 장면 막대의 ‘장면 설정’에서 배경을 넣고, 장면을 더 만들 수 있어요." },
                { done: objects.length > 0, title: "토큰·소품 놓기", hint: "아래의 ‘+ 토큰’, ‘+ 소품’으로 놓고, 끌어서 옮겨요." },
                { done: state.members.some((m) => m.role === "pl"), title: "PL 부르기", hint: "오른쪽 위 ‘초대’에서 링크를 만들어 보내요." },
                { done: false, title: "세션 시작", hint: "준비가 끝나면 오른쪽 위 ‘세션 시작’을 눌러요. 그 전엔 PL이 움직일 수 없어요." },
              ]}
              onClose={() => setGuideClosed(true)}
            />
          )}
          {isKp && <SceneBar me={me} scenes={scenes} tracks={state.audioLibrary} activeId={state.activeSceneId} viewId={shownSceneId} onView={setViewSceneId} enabled canActivate={!paused} send={send} />}
          <Board grid={board.grid} viewKey={board.sceneId ? viewKey(me.userId, roomId, board.sceneId) : undefined} snapKey={board.sceneId ? snapKey(me.userId, roomId, board.sceneId) : undefined} onOpenSheet={(o) => o.characterId && (isKp || o.ownerId === me.userId) && state.characters[o.characterId] && openSheet(o.characterId)} objects={board.objects} background={board.background} me={{ userId: me.userId, role }} canInteract={canEditBoard} onMove={move} selectedId={selectedId} onSelect={setSelectedId} fog={board.fog} onPing={canPing ? ping : undefined} pings={state.pings} sceneId={board.sceneId} turnTokenIds={turnTokenIds} onDragStart={onDragStart} animate={fx.enabled} onPick={isKp && fogPicking ? (x, y) => send({ type: "fog.reveal", data: { sceneId: shownSceneId, x, y, r: fogRadius } }) : undefined} {...interactions.boardProps} {...(isKp && !board.background ? { hint: "이미지를 끌어다 놓아 배경을 정해요" } : {})} />
          {interactions.ui}
          {isKp && !phone && (
            <StageCues roomId={roomId} enabled={state.sessionStatus !== "PAUSED"} send={send} source={cueSource} sessionActive={active} notify={notices.notify} />
          )}
          {role === "pl" && selected && canEditMarkers(role, me.userId, selected) && (
            <div className="dock dock-hint" data-testid="pl-marker-dock">
              <span className="dock-note">{selected.name}</span>
              <MarkerButton obj={selected} canSecret={false} enabled={active} send={send} />
            </div>
          )}
          {role === "pl" && state.ready && !hasToken && state.sessionStatus !== "PAUSED" && (
            <div className="dock dock-hint" role="status" data-testid="no-token-hint">아직 내 토큰이 없어요. GM에게 요청하거나 기다려요</div>
          )}
          <SceneTransition fade={fade} />
          {!isKp && board.name && <div className="scene-name" data-testid="scene-name">{board.name}</div>}
          {!isKp && fogView && (
            <div className="fog-note" data-testid="fog-note">
              <Hint term="fog" label="안개와 시야 설명">안개 켜짐</Hint> · 시야 밖은 어둡게 보여요
            </div>
          )}
          {isKp && !phone && <UndoButton onUndo={undo} />}
          {isKp && !phone && shownScene && (
            <FogToolbar scene={shownScene} selected={selected} partyTokens={objects.filter((o) => o.kind === "token" && o.ownerId)} enabled={canEditBoard} picking={fogPicking} radius={fogRadius} onPicking={setFogPicking} onRadius={setFogRadius} send={sendWithHint} />
          )}
          {isKp && !phone && (
            <ObjectToolbar
              me={me}
              enabled={canEditBoard}
              sceneId={shownSceneId}
              objects={objects}
              players={players}
              selected={selected}
              characters={characters}
              onOpenSheet={openSheet}
              send={sendWithHint}
              onDeselect={() => setSelectedId(null)}
              placement={placement}
            />
          )}
          {isKp && phone && (
            <ToolSheet<SheetTab>
              open={panels.sheetOpen}
              tab={panels.sheetTab}
              onToggle={() => dispatchPanels({ type: "sheet.toggle" })}
              onTab={(t) => dispatchPanels({ type: "sheet.tab", tab: t })}
              tabs={[
                { id: "place", label: "놓기" },
                { id: "fog", label: "안개" },
                { id: "select", label: "선택", ...(selected ? { hint: selected.name } : {}) },
                { id: "cues", label: "연출" },
              ]}
              quick={
                <>
                  <QuickTokenButton placement={placement} enabled={canEditBoard} />
                  <button type="button" className="btn" data-testid="quick-select" disabled={!selected} title={selected ? "고른 것의 이름·소유자·삭제 같은 도구를 열어요" : "토큰이나 소품을 먼저 눌러 골라요"} onClick={() => dispatchPanels({ type: "sheet.open", tab: "select" })}>{selectLabel(selected?.name)}</button>
                  <UndoButton inline onUndo={undo} />
                  <button type="button" className="btn" data-testid="open-drawer" onClick={(e) => { drawerOpener.current = e.currentTarget; dispatchPanels({ type: "drawer.open" }); }}>
                    패널{chatUnread > 0 && <span className="tab-dot" aria-label={`안 읽은 대화 ${chatUnread}개`}>{chatUnread > 99 ? "99+" : chatUnread}</span>}
                  </button>
                </>
              }
              sections={{
                place: (
                  <div className="sheet-grid">
                    <PlaceControls placement={placement} enabled={canEditBoard} players={players} withTokenButton={false} />
                  </div>
                ),
                fog: shownScene ? (
                  <FogToolbar bare scene={shownScene} selected={selected} partyTokens={objects.filter((o) => o.kind === "token" && o.ownerId)} enabled={canEditBoard} picking={fogPicking} radius={fogRadius} onPicking={setFogPicking} onRadius={setFogRadius} send={sendWithHint} />
                ) : null,
                select: selected ? (
                  <div className="sheet-grid" data-testid="selected-bar">
                    <SelectedControls me={me} enabled={canEditBoard} players={players} selected={selected} characters={characters} onOpenSheet={openSheet} send={sendWithHint} onDeselect={() => setSelectedId(null)} />
                  </div>
                ) : (
                  <p className="why">보드에서 토큰이나 소품을 눌러 고르면 여기서 이름·소유자·삭제를 고칠 수 있어요.</p>
                ),
                cues: <StageCues bare roomId={roomId} enabled={state.sessionStatus !== "PAUSED"} send={send} source={cueSource} sessionActive={active} notify={notices.notify} />,
              }}
            />
          )}
          {!isKp && phone && (
            <PanelDock
              label="패널 열기"
              items={[
                { id: "roll", label: "굴림", primary: true, testId: "dock-roll", onClick: () => showTab("roll") },
                { id: "sheet", label: "시트", testId: "dock-sheet", onClick: () => showTab("sheet") },
                { id: "handout", label: "핸드아웃", testId: "dock-handout", badge: newHandouts.length, badgeLabel: `새 핸드아웃 ${newHandouts.length}개`, onClick: () => showTab("handout") },
                { id: "chat", label: "대화", testId: "dock-chat", badge: chatUnread, badgeLabel: `안 읽은 대화 ${chatUnread}개`, onClick: () => showTab("chat") },
              ]}
            />
          )}
        </main>

        {phone && panels.drawerOpen && <div className="drawer-backdrop" data-testid="drawer-backdrop" aria-hidden onClick={closeDrawer} />}
        <aside className={`side${phone ? (panels.drawerOpen ? " drawer-open" : "") : panelOpen ? "" : " collapsed"}`} data-testid="side-panel" {...(phone && !panels.drawerOpen ? { inert: true, "aria-hidden": true } : {})} {...(phone ? { role: "region", "aria-label": "패널 서랍" } : {})}>
          <button type="button" className="side-toggle" data-testid="drawer-close" aria-expanded={panelVisible} onClick={() => (phone ? closeDrawer() : setPanelOpen((o) => !o))}>{phone ? "닫기" : panelOpen ? "패널 접기" : "패널 펴기"}{!panelVisible && chatUnread > 0 && <span className="tab-dot" data-testid="chat-unread-toggle" aria-label={`안 읽은 대화 ${chatUnread}개`}>{chatUnread > 99 ? "99+" : chatUnread}</span>}</button>
          <div className="tabs" role="tablist" aria-label="패널" onKeyDown={onTabListKeyDown}>
            <button role="tab" aria-selected={tab === "roll"} onClick={() => setTab("roll")}>굴림</button>
            <button role="tab" aria-selected={tab === "sheet"} onClick={() => setTab("sheet")}>시트</button>
            <button role="tab" aria-selected={tab === "handout"} onClick={() => setTab("handout")}>핸드아웃{newHandouts.length > 0 && <span className="tab-dot" data-testid="handout-new" aria-label={`새 핸드아웃 ${newHandouts.length}개`}>{newHandouts.length}</span>}</button>
            <button role="tab" aria-selected={tab === "chat"} data-testid="tab-chat" onClick={() => setTab("chat")}>대화{chatUnread > 0 && <span className="tab-dot" data-testid="chat-unread" aria-label={`안 읽은 대화 ${chatUnread}개`}>{chatUnread > 99 ? "99+" : chatUnread}</span>}</button>
            {isKp && state.flow && (
              <button role="tab" aria-selected={tab === "flow"} onClick={() => setTab("flow")}>흐름{state.flow.suggestions.length > 0 ? " ●" : ""}</button>
            )}
            {isKp && (
              <button role="tab" aria-selected={tab === "sound"} onClick={() => setTab("sound")}>음향{state.bgm ? " ♪" : ""}</button>
            )}
            <button role="tab" aria-selected={tab === "combat"} onClick={() => setTab("combat")}>전투{myTurn ? <span className="tab-dot turn" data-testid="combat-my-turn" aria-label="내 차례">▶</span> : state.initiative ? " ●" : ""}</button>
            <button role="tab" aria-selected={tab === "log"} data-testid="tab-log" onClick={() => setTab("log")}>기록</button>
          </div>
          <ChatPanel
            messages={state.chat}
            members={state.members}
            meId={me.userId}
            meName={me.name}
            role={role}
            speakable={speakable}
            characters={characters}
            plWhisper={state.chatSettings.plWhisper}
            spectatorChat={state.chatSettings.spectatorChat === true}
            rollWhy={rollBlockReason(role, state.sessionStatus)}
            visible={tab === "chat"}
            ready={state.ready && state.chatLoaded}
            send={send}
            onSetPlWhisper={(on) => send({ type: "settings.chat", data: { plWhisper: on, spectatorChat: state.chatSettings.spectatorChat === true } })}
            onSetSpectatorChat={(on) => send({ type: "settings.chat", data: { plWhisper: state.chatSettings.plWhisper, spectatorChat: on } })}
            onLoadOlder={loadOlderChat}
          />
          <LogPanel me={me} roomId={roomId} roomTitle={roomName ?? "세션 기록"} isKp={isKp} sessionCount={state.sessionNumber} visible={tab === "log"} version={logVersion} />
          {tab === "chat" || tab === "log" ? null : tab === "roll" ? (
            <RollPanel
              me={me}
              rolls={state.rolls}
              userId={me.userId}
              characters={characters}
              hidden={state.hiddenRolls}
              isKp={isKp}
              disabled={!active || role === "spectator"}
              disabledReason={rollBlockReason(role, state.sessionStatus)}
              error={null}
              onRoll={(expr, secret, characterId) => send({ type: "roll.request", data: { expr, secret, ...(characterId ? { characterId } : {}) } })}
              onPush={(rollId) => send({ type: "roll.push", data: { rollId } })}
              onLuck={(rollId) => send({ type: "luck.spend", data: { rollId } })}
              players={state.members.filter((m) => m.role === "pl").map((m) => ({ userId: m.userId, name: m.name }))}
              onAsk={(name, difficulty, targetUserId) => send({ type: "roll.ask", data: { name, ...(difficulty ? { difficulty } : {}), ...(targetUserId ? { targetUserId } : {}) } })}
              onGroup={(name, difficulty, targetUserId, secret) => send({ type: "roll.group", data: { name, secret: secret === true, ...(difficulty ? { difficulty } : {}), ...(targetUserId ? { userIds: [targetUserId] } : {}) } })}
              onOpposed={role === "spectator" ? undefined : (a, b, secret) => send({ type: "roll.opposed", data: { a, b, secret } })}
              damageApplied={state.damageApplied}
              onApplyDamage={isKp ? (rollId, characterId, armor) => send({ type: "damage.apply", data: { characterId, rollId, armor } }) : undefined}
            />
          ) : tab === "flow" && isKp && state.flow ? (
            <FlowPanel flow={state.flow} scenes={scenes} handouts={handoutList} tracks={state.audioLibrary} status={state.sessionStatus} enabled send={send} />
          ) : tab === "sound" && isKp ? (
            <AudioPanel me={me} library={state.audioLibrary} bgm={state.bgm} enabled send={send} />
          ) : tab === "combat" ? (
            <InitiativePanel initiative={state.initiative} isKp={isKp} enabled={state.sessionStatus !== "PAUSED"} send={send} />
          ) : tab === "handout" ? (
            <HandoutPanel me={me} handouts={handoutList} isKp={isKp} canEdit={isKp || !paused} canShow={!paused} players={state.members} send={send} />
          ) : (
            <div className="sheet-wrap">
              {characters.length > 0 && (
                <SheetPanel
                  characters={characters}
                  selectedId={sheet?.id ?? null}
                  onSelect={setSheetId}
                  canAct={active && role !== "spectator"}
                  rollWhy={rollBlockReason(role, state.sessionStatus)}
                  canEdit={role !== "spectator" && (active || isKp)}
                  canEditText={role !== "spectator" && (!paused || isKp)}
                  onPatch={(characterId, ops) => send({ type: "sheet.patch", data: { characterId, ops } })}
                  isKp={isKp}
                  onSanCheck={(characterId, loss) => {
                    if (send({ type: "san.check", data: { characterId, loss } }) !== false) sheetRollAt.current = Date.now();
                  }}
                  onNewDay={(characterId) => send({ type: "san.newDay", data: { characterId } })}
                  onDamage={(characterId, weaponIndex) => {
                    if (send({ type: "damage.roll", data: { characterId, weaponIndex } }) !== false) sheetRollAt.current = Date.now();
                  }}
                  onMadnessRoll={(characterId, mode) => send({ type: "madness.roll", data: { characterId, mode } })}
                  onApplyDamage={isKp ? (characterId, amount, armor) => send({ type: "damage.apply", data: { characterId, amount, armor } }) : undefined}
                  onHeal={isKp ? (characterId, kind, amount) => send({ type: "hp.heal", data: { characterId, kind, ...(amount !== undefined ? { amount } : {}) } }) : undefined}
                  npcIds={npcIds}
                  onRemove={isKp || (role === "pl" && state.sessionStatus === "IDLE" && state.sessionNumber === 0 && sheet?.ownerId === me.userId) ? (characterId) => send({ type: "character.remove", data: { id: characterId } }) : undefined}
                  onRoll={(characterId, name, o: RollOptions) => {
                    // 시트를 보던 자리에서 결과를 토스트로 알려 주고, 굴림 탭으로 옮기지 않는다(굴림 기록에는 그대로 쌓인다).
                    if (send({ type: "roll.request", data: { secret: o.secret === true, skill: { characterId, name, bonus: o.bonus, ...(o.difficulty ? { difficulty: o.difficulty } : {}) } } }) !== false) sheetRollAt.current = Date.now();
                  }}
                />
              )}
              <div className="sheet-foot">
                {isKp && sheet && (
                  <button
                    className="btn"
                    disabled={!canEditBoard}
                    title="이 시트에 이어진 토큰을 지금 보는 장면에 놓아요"
                    onClick={() => {
                      const owner = state.members.find((m) => m.userId === sheet.ownerId && m.role === "pl");
                      send({ type: "object.add", data: { kind: "token", name: uniqueName(sheet.name, objects.map((o) => o.name)), x: 500, y: 400, layer: "object", visibleTo: "all", sceneId: shownSceneId, autoPlace: true, characterId: sheet.id, ...(owner ? { ownerId: owner.userId } : {}) } });
                    }}
                  >
                    토큰으로 놓기
                  </button>
                )}
                {isKp && (
                  <NpcSheetButton
                    count={characters.length}
                    disabled={!canEditBoard}
                    onCreate={(data, place) => {
                      npcPending.current = { before: new Set(characters.map((c) => c.id)), place };
                      if (send({ type: "character.add", data }) === false) npcPending.current = null;
                    }}
                  />
                )}
                {role === "pl" && !hasOwn && <RoomCharacterCreate me={me} send={send} disabled={paused} onDone={notices.notify} />}
                {role !== "spectator" && (isKp || !hasOwn) && <LoadCharacter me={me} send={send} disabled={paused && !isKp} {...(isKp ? { title: "보관함에서 NPC·캐릭터 불러오기" } : {})} />}
                {role !== "spectator" && (isKp || !hasOwn) && (
                  <SheetCsvImport me={me} applyLabel="룸에 등록" disabled={paused && !isKp} onApply={(data) => send({ type: "character.add", data })} />
                )}
                {characters.length === 0 && <SheetEmpty role={role} canLoad={!hasOwn} />}
                {state.sessionStatus === "IDLE" && state.sessionNumber > 0 && sheet && sheet.ownerId === me.userId && <SaveToVaultButton key={`${sheet.id}-${sheet.rev}`} me={me} character={sheet} />}
              </div>
            </div>
          )}
        </aside>
      </div>
    {shortcutHelp.open && <ShortcutHelp isKp={isKp} onClose={shortcutHelp.close} />}
    </div>
    </ImageLibraryProvider>
  );
}
