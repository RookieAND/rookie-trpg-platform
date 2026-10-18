"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { GameObject, Role } from "@coc-vtt/shared";
import { useIdentity, type Identity } from "@/entities/user";
import { ObjectToolbar } from "@/features/board-objects";
import { FogToolbar } from "@/features/manage-fog";
import { Hint } from "@/shared/ui";
import { SceneBar } from "@/features/manage-scenes";
import { StageCues } from "@/features/stage-cues";
import { useEffectPreference } from "@/features/effect-preference";
import { SoundControl, useAudioEngine, useAudioPreference } from "@/features/audio-playback";
import { LoadCharacter } from "@/features/load-character";
import { useRoom } from "@/features/room-realtime";
import { MadnessResultCard } from "@/features/manage-madness";
import { EndSummaryCard } from "@/features/session-control";
import { SaveToVaultButton } from "@/features/save-to-vault";
import { AudioPanel } from "@/widgets/audio-panel";
import { Board } from "@/widgets/board";
import { HandoutPanel } from "@/widgets/handout-panel";
import { FlowPanel } from "@/widgets/flow-panel";
import { InitiativePanel } from "@/widgets/initiative-panel";
import { HandoutSpotlight } from "@/widgets/handout-spotlight";
import { RollEffect } from "@/widgets/roll-effect";
import { RollPanel } from "@/widgets/roll-panel";
import { SceneTransition } from "@/widgets/scene-transition";
import { RoomHeader } from "@/widgets/room-header";
import { StartGuide } from "./StartGuide";
import { PlayerGuide } from "./PlayerGuide";
import { playerGuideSteps, readGuideClosed, showPlayerGuide, writeGuideClosed } from "../model/player-guide";
import { SheetPanel, SheetEmpty, type RollOptions } from "@/widgets/sheet-panel";

const REJECTED: Record<number, string> = {
  4401: "로그인 정보가 올바르지 않아요.",
  4403: "이 룸에 들어갈 수 없어요. 초대 링크가 없거나 만료됐어요. KP에게 새 링크를 받아 주세요.",
  4404: "룸을 찾을 수 없어요. 룸을 만든 사람이 지웠을 수 있어요.",
  4409: "룸 인원이 가득 찼어요.",
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
  const { state, connection, closeCode, send } = useRoom({ roomId, user: me.userId, name: me.name, token: me.token, invite });
  const [guideClosed, setGuideClosed] = useState(false);
  const [plGuideClosed, setPlGuideClosed] = useState(false);
  useEffect(() => setPlGuideClosed(readGuideClosed(roomId)), [roomId]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fx = useEffectPreference();
  const sound = useAudioPreference();
  const [tab, setTab] = useState<"roll" | "sheet" | "handout" | "combat" | "flow" | "sound">("roll");
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [dismissedN, setDismissedN] = useState(0);
  const [viewSceneId, setViewSceneId] = useState<string | null>(null);
  const [fogPicking, setFogPicking] = useState(false);
  const [fogRadius, setFogRadius] = useState(120);
  const [panelOpen, setPanelOpen] = useState(true); // 좁은 화면에서만 보이는 패널 접기

  // 역할은 서버가 확정한 값을 쓴다. 접속 전에는 PL로 임시 표시한다.
  const role: Role = state.members.find((m) => m.userId === me.userId)?.role ?? "pl";
  const isKp = role === "kp";
  const active = state.sessionStatus === "ACTIVE";
  // 세션 전(준비 모드)에는 KP도 보드를 만질 수 있다.
  // 일시정지 중에도 KP는 준비성 편집(토큰·소품·안개·장면·시트·핸드아웃·흐름·음향)을 할 수 있다.
  // 판정·전투·장면 전환처럼 이야기를 앞으로 미는 것만 이어하기 뒤에 한다(서버가 같은 규칙으로 막는다).
  const paused = state.sessionStatus === "PAUSED";
  const canEditBoard = active || isKp;
  const kpAway = active && !isKp && state.kpAwaySince !== null;
  const scenes = useMemo(() => Object.values(state.scenes), [state.scenes]);
  // KP는 활성이 아닌 장면도 골라 꾸밀 수 있고, 장면이 사라지면 활성 장면으로 돌아온다.
  const shownSceneId = isKp && viewSceneId && state.scenes[viewSceneId] ? viewSceneId : state.activeSceneId;
  const objects = useMemo(() => Object.values(state.objects).filter((o) => o.sceneId === shownSceneId), [state.objects, shownSceneId]);
  const characters = useMemo(() => Object.values(state.characters), [state.characters]);
  const sheet = characters.find((c) => c.id === sheetId) ?? characters[0];
  const hasOwn = characters.some((c) => c.ownerId === me.userId);
  const spot = state.spotlight && state.spotlight.n > dismissedN ? state.handouts[state.spotlight.id] : undefined;
  const handoutList = useMemo(() => Object.values(state.handouts), [state.handouts]);
  const cueSource = useMemo(() => ({ scenes, activeSceneId: state.activeSceneId, handouts: handoutList, objects }), [scenes, state.activeSceneId, handoutList, objects]);
  const endBeat = state.flow?.beats.find((b) => b.id === state.flow?.current && b.kind === "ending");
  const endingDefaults = endBeat ? { name: endBeat.name, ...(endBeat.sanReward ? { sanReward: endBeat.sanReward } : {}) } : undefined;
  const selected = selectedId ? state.objects[selectedId] : undefined;
  // 안개: KP는 설정(밝힌 영역 + 시야 토큰)으로 미리 보고, 나머지는 서버가 알려 준 지금 보이는 원들을 쓴다.
  const shownScene = state.scenes[shownSceneId];
  const fogView = useMemo(() => {
    if (isKp) {
      if (!shownScene?.fog?.enabled) return undefined;
      const areas = [...shownScene.fog.zones.map((z) => ({ x: z.x, y: z.y, r: z.r })), ...objects.filter((o) => o.vision).map((o) => ({ x: o.x, y: o.y, r: o.vision! }))];
      return { areas, preview: true, explored: shownScene.fog.explored };
    }
    return shownScene?.fogAreas ? { areas: shownScene.fogAreas, preview: false, explored: shownScene.fogExplored } : undefined;
  }, [isKp, shownScene, objects]);
  const audio = useAudioEngine({ bgm: state.bgm, lastSe: state.lastSe, clockOffset: state.clockOffset, lastRollId: state.rolls.at(-1)?.id ?? null, ready: state.ready, prefs: sound.prefs });

  if (closeCode !== null && REJECTED[closeCode]) {
    return (
      <main className="login">
        <div className="err" role="alert">{REJECTED[closeCode]}</div>
        <Link className="btn" href="/">로비로</Link>
      </main>
    );
  }

  const move = (o: GameObject, x: number, y: number) => send({ type: "object.move", data: { id: o.id, x, y, rev: o.rev } });

  return (
    <div className="room">
      <RoomHeader me={me} roomId={roomId} role={role} status={state.sessionStatus} kpAway={kpAway} sessionNumber={state.sessionNumber} connection={connection} members={state.members} effects={state.effects} madnessTable={state.madnessTable} endingDefaults={endingDefaults} effectsEnabled={fx.enabled} onToggleEffects={fx.toggle} soundControl={<SoundControl prefs={sound.prefs} onChange={sound.update} unlocked={audio.unlocked} onUnlock={audio.unlock} playing={audio.playing} />} send={send} />

      <EndSummaryCard summary={state.lastEnd} />
      <MadnessResultCard last={state.lastMadness} />

      <RollEffect rolls={state.rolls} ready={state.ready} effects={state.effects} enabled={fx.enabled} />
      {spot && <HandoutSpotlight handout={spot} onClose={() => setDismissedN(state.spotlight?.n ?? 0)} />}

      <div className="body">
        <main className="board">
          {kpAway && <div className="banner" role="status" data-testid="kp-away-banner">KP 연결이 끊겼어요. 잠시 기다려요.</div>}
          {paused && <div className="banner" role="status">세션이 일시정지 중이에요. KP가 돌아오면 이어서 진행해요.</div>}
          {state.sessionStatus === "IDLE" && !isKp && (
            <div className="banner" role="status">KP가 세션을 시작하기를 기다리고 있어요.</div>
          )}
          {showPlayerGuide({ role, ready: state.ready, sessionStatus: state.sessionStatus, closed: plGuideClosed }) && (
            <PlayerGuide spectator={role === "spectator"} steps={playerGuideSteps({ role, userId: me.userId, characters, rolls: state.rolls, handouts: handoutList })} onClose={() => { setPlGuideClosed(true); writeGuideClosed(roomId); }} />
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
          <Board objects={objects} background={state.scenes[shownSceneId]?.background} me={{ userId: me.userId, role }} canInteract={canEditBoard} onMove={move} selectedId={selectedId} onSelect={setSelectedId} fog={fogView} onPick={isKp && fogPicking ? (x, y) => send({ type: "fog.reveal", data: { sceneId: shownSceneId, x, y, r: fogRadius } }) : undefined} />
          {isKp && (
            <StageCues roomId={roomId} enabled={state.sessionStatus !== "PAUSED"} send={send} source={cueSource} />
          )}
          <SceneTransition transition={state.transition} />
          {!isKp && state.scenes[state.activeSceneId] && <div className="scene-name" data-testid="scene-name">{state.scenes[state.activeSceneId]!.name}</div>}
          {!isKp && fogView && (
            <div style={{ position: "absolute", right: 12, bottom: 12, zIndex: 2, color: "var(--muted)", fontSize: 12.5 }} data-testid="fog-note">
              <Hint term="fog" label="안개와 시야 설명">안개 켜짐</Hint> · 시야 밖은 어둡게 보여요
            </div>
          )}
          {isKp && shownScene && (
            <FogToolbar scene={shownScene} selected={selected} enabled={canEditBoard} picking={fogPicking} radius={fogRadius} onPicking={setFogPicking} onRadius={setFogRadius} send={send} />
          )}
          {isKp && (
            <ObjectToolbar
              me={me}
              enabled={canEditBoard}
              sceneId={shownSceneId}
              objectCount={objects.length}
              firstPlayerId={state.members.find((m) => m.role === "pl")?.userId}
              selected={selected}
              send={send}
              onDeselect={() => setSelectedId(null)}
            />
          )}
        </main>

        <aside className={`side${panelOpen ? "" : " collapsed"}`}>
          <button type="button" className="side-toggle" aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>{panelOpen ? "패널 접기" : "패널 펴기"}</button>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "roll"} onClick={() => setTab("roll")}>굴림</button>
            <button role="tab" aria-selected={tab === "sheet"} onClick={() => setTab("sheet")}>시트</button>
            <button role="tab" aria-selected={tab === "handout"} onClick={() => setTab("handout")}>핸드아웃</button>
            {isKp && state.flow && (
              <button role="tab" aria-selected={tab === "flow"} onClick={() => setTab("flow")}>흐름{state.flow.suggestions.length > 0 ? " ●" : ""}</button>
            )}
            {isKp && (
              <button role="tab" aria-selected={tab === "sound"} onClick={() => setTab("sound")}>음향{state.bgm ? " ♪" : ""}</button>
            )}
            <button role="tab" aria-selected={tab === "combat"} onClick={() => setTab("combat")}>전투{state.initiative ? " ●" : ""}</button>
          </div>
          {tab === "roll" ? (
            <RollPanel
              me={me}
              rolls={state.rolls}
              userId={me.userId}
              characters={characters}
              hidden={state.hiddenRolls}
              isKp={isKp}
              disabled={!active || role === "spectator"}
              error={state.lastError?.message ?? null}
              onRoll={(expr, secret) => send({ type: "roll.request", data: { expr, secret } })}
              onPush={(rollId) => send({ type: "roll.push", data: { rollId } })}
              onLuck={(rollId) => send({ type: "luck.spend", data: { rollId } })}
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
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {characters.length > 0 && (
                <SheetPanel
                  characters={characters}
                  selectedId={sheet?.id ?? null}
                  onSelect={setSheetId}
                  canAct={active && role !== "spectator"}
                  canEdit={role !== "spectator" && (active || isKp)}
                  onPatch={(characterId, ops) => send({ type: "sheet.patch", data: { characterId, ops } })}
                  isKp={isKp}
                  onSanCheck={(characterId, loss) => {
                    send({ type: "san.check", data: { characterId, loss } });
                    setTab("roll");
                  }}
                  onNewDay={(characterId) => send({ type: "san.newDay", data: { characterId } })}
                  onDamage={(characterId, weaponIndex) => {
                    send({ type: "damage.roll", data: { characterId, weaponIndex } });
                    setTab("roll");
                  }}
                  onMadnessRoll={(characterId, mode) => send({ type: "madness.roll", data: { characterId, mode } })}
                  onRemove={isKp || (role === "pl" && state.sessionStatus === "IDLE" && state.sessionNumber === 0 && sheet?.ownerId === me.userId) ? (characterId) => send({ type: "character.remove", data: { id: characterId } }) : undefined}
                  onRoll={(characterId, name, o: RollOptions) => {
                    send({ type: "roll.request", data: { secret: false, skill: { characterId, name, bonus: o.bonus, ...(o.difficulty ? { difficulty: o.difficulty } : {}) } } });
                    setTab("roll");
                  }}
                />
              )}
              <div style={{ padding: 16, display: "grid", gap: 12, marginTop: characters.length > 0 ? "auto" : 0 }}>
                {role !== "spectator" && (isKp || !hasOwn) && <LoadCharacter me={me} send={send} disabled={paused && !isKp} />}
                {characters.length === 0 && <SheetEmpty role={role} canLoad={!hasOwn} />}
                {state.sessionStatus === "IDLE" && state.sessionNumber > 0 && sheet && sheet.ownerId === me.userId && <SaveToVaultButton key={`${sheet.id}-${sheet.rev}`} me={me} character={sheet} />}
                {state.lastError && <div className="err" role="alert">{state.lastError.message}</div>}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
