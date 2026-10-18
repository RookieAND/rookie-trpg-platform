/**
 * 시나리오 파일(JSON)을 룸 하나로 옮긴다: 장면, 소품·NPC 토큰, NPC 시트, 핸드아웃, 세션 흐름(비트·분기),
 * 광기 증상표(madnessTable), 음원(audio — 로컬 오디오 파일을 올리고 장면·비트 배경음에 연결).
 * 룸을 만들기 전에 파일 존재·크기·형식·참조를 전부 검증하므로, 문제가 있으면 룸이 만들어지지 않는다.
 * 형식은 docs/scenario-format.md 를 본다.
 * GM이 직접 룸을 만든 것처럼 서버에 명령을 보내므로 저장소(파일/Postgres)와 상관없이 같은 방식으로 저장된다.
 *
 * 사용법(서버가 켜져 있어야 한다):
 *   pnpm import:scenario <시나리오.json> [--user 이름] [--api http://localhost:8787] [--room 룸이름]
 *
 * 개발용 로그인에서는 이름이 곧 신원이다. 웹 로비에서 같은 이름으로 로그인하면 룸이 "내 룸"에 보인다.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import WebSocket from "ws";
import { splitNoteTitle, validateScenario, type ScenarioFile } from "./scenario-validate";
import { defaultSkillValues, josa, type ClientCommand, type Flow, type Scene, type ServerMessage, type Snapshot } from "@coc-vtt/shared";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) opt[a.slice(2)] = argv[++i] ?? "";
    else positional.push(a);
  }
  return { file: positional[0], user: opt.user ?? "RookieAND", api: opt.api ?? "http://localhost:8787", room: opt.room };
}

class Kp {
  private ws!: WebSocket;
  private seq = 0;
  private reqNo = 0;
  private waiters: Array<(m: ServerMessage) => void> = [];
  snapshot!: Snapshot;

  constructor(private readonly url: string) {}

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on("error", reject);
      this.ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString()) as ServerMessage;
        if (m.event.type === "snapshot") this.snapshot = m.event.data;
        else if (m.seq > this.seq) this.seq = m.seq;
        for (const w of this.waiters.splice(0)) w(m);
      });
      this.ws.once("open", () => {
        this.ws.send(JSON.stringify({ type: "join", data: {} }));
        const wait = (m: ServerMessage) => (m.event.type === "snapshot" ? resolve() : this.waiters.push(wait));
        this.waiters.push(wait);
      });
    });
  }

  /** 명령을 보내고 서버가 결과 이벤트를 보내거나 오류를 돌려줄 때까지 기다린다. 받은 이벤트를 돌려준다. */
  send(command: ClientCommand): Promise<ServerMessage["event"][]> {
    const id = `imp-${++this.reqNo}`;
    const before = this.seq;
    return new Promise((resolve, reject) => {
      const got: ServerMessage["event"][] = [];
      const timer = setTimeout(() => reject(new Error(`응답이 없어요: ${command.type}`)), 8000);
      let settle: ReturnType<typeof setTimeout> | undefined;
      const onMsg = (m: ServerMessage) => {
        if (m.event.type === "error") {
          if (m.event.data.requestId !== id) return void this.waiters.push(onMsg);
          clearTimeout(timer);
          return reject(new Error(`${command.type}: ${m.event.data.message}`));
        }
        if (m.seq > before) got.push(m.event);
        // 한 명령이 여러 이벤트를 낼 수 있어 잠깐 더 모은다.
        clearTimeout(settle);
        settle = setTimeout(() => {
          clearTimeout(timer);
          resolve(got);
        }, 60);
        this.waiters.push(onMsg);
      };
      this.waiters.push(onMsg);
      this.ws.send(JSON.stringify({ id, command }));
    });
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  const { file, user, api, room } = parseArgs(process.argv.slice(2));
  if (!file) throw new Error("사용법: pnpm import:scenario <시나리오.json> [--user 이름] [--api 주소] [--room 룸이름]");
  const sc = JSON.parse(readFileSync(file, "utf8")) as ScenarioFile;
  if (sc.format !== "roll-and-call-scenario" || sc.version !== 1) throw new Error("지원하지 않는 시나리오 파일이에요.");

  // 룸을 만들기 전에 전부 검증한다. 오디오 파일은 한 번만 읽어 두고 그대로 올린다.
  const baseDir = dirname(resolve(file));
  const audioBytes = new Map<string, Buffer>();
  const problems = validateScenario(sc, (rel) => {
    const abs = resolve(baseDir, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) return null;
    const bytes = readFileSync(abs);
    audioBytes.set(rel, bytes);
    return bytes;
  });
  if (problems.length > 0) throw new Error(`시나리오 파일에 문제가 있어서 룸을 만들지 않았어요.\n${problems.map((p) => `  - ${p}`).join("\n")}`);

  const userId = user.trim().toLowerCase().replace(/\s+/g, "-");
  const enc = encodeURIComponent;
  const headers = { "content-type": "application/json", "x-dev-user": enc(userId), "x-dev-name": enc(user) };

  // 오디오는 룸을 만들기 전에 올린다. 업로드가 실패해도 빈 룸이 남지 않는다(올라간 파일은 쓰이지 않을 뿐이다).
  const assetByKey = new Map<string, string>();
  for (const a of sc.audio ?? []) {
    const r = await fetch(`${api}/audio`, { method: "POST", headers: { ...headers, "content-type": "application/octet-stream" }, body: new Uint8Array(audioBytes.get(a.file)!) });
    const text = await r.text();
    if (!r.ok) throw new Error(`음원을 올리지 못했어요(${a.key}, ${r.status}): ${text}`);
    assetByKey.set(a.key, (JSON.parse(text) as { id: string }).id);
  }

  const res = await fetch(`${api}/rooms`, { method: "POST", headers, body: JSON.stringify({ name: room ?? sc.roomName }) });
  if (!res.ok) throw new Error(`룸을 만들지 못했어요(${res.status}): ${await res.text()}`);
  const created = (await res.json()) as { id: string; name: string; invite: { code: string } };

  const wsUrl = `${api.replace(/^http/, "ws")}/ws?${new URLSearchParams({ room: created.id, user: userId, name: user })}`;
  const kp = new Kp(wsUrl);
  await kp.open();

  if (sc.madnessTable) await kp.send({ type: "settings.madness", data: { entries: sc.madnessTable.map((e) => e.trim()) } });

  // 음원 라이브러리: key → 트랙 id
  const trackId = new Map<string, string>();
  for (const a of sc.audio ?? []) {
    const assetId = assetByKey.get(a.key)!;
    const ev = await kp.send({ type: "audio.track.add", data: { label: a.label.trim(), kind: a.kind, assetId, volume: 80 } });
    const lib = ev.find((e) => e.type === "audio.library");
    const track = lib && lib.type === "audio.library" ? lib.data.tracks.find((t) => t.assetId === assetId) : undefined;
    if (!track) throw new Error(`음원을 라이브러리에 넣지 못했어요: ${a.key}`);
    trackId.set(a.key, track.id);
  }

  const sceneId = new Map<string, string>();
  const handoutId = new Map<string, string>();
  const beatId = new Map<string, string>();

  // 장면: 처음 있는 장면의 이름을 바꿔 첫 장면으로 쓰고, 나머지는 새로 만든다.
  const first = kp.snapshot.scenes[0] as Scene;
  for (const [i, s] of sc.scenes.entries()) {
    if (i === 0) {
      await kp.send({ type: "scene.rename", data: { id: first.id, name: s.name } });
      sceneId.set(s.key, first.id);
    } else {
      const ev = await kp.send({ type: "scene.create", data: { name: s.name } });
      const added = ev.find((e) => e.type === "scene.added");
      if (!added || added.type !== "scene.added") throw new Error(`장면을 만들지 못했어요: ${s.name}`);
      sceneId.set(s.key, added.data.id);
    }
    if (s.bgm) await kp.send({ type: "scene.setBgm", data: { id: sceneId.get(s.key)!, trackId: trackId.get(s.bgm)! } });
    if (s.start) await kp.send({ type: "scene.setStart", data: { id: sceneId.get(s.key)! } });
  }

  for (const t of sc.tokens) {
    await kp.send({ type: "object.add", data: { kind: t.kind, name: t.name, x: t.x, y: t.y, layer: t.layer, visibleTo: t.visibleTo, sceneId: sceneId.get(t.scene)! } });
  }

  for (const c of sc.characters) {
    const merged = new Map(defaultSkillValues({ characteristics: c.characteristics }).map((s) => [s.name, s.value]));
    for (const s of c.skills) merged.set(s.name, s.value);
    await kp.send({
      type: "character.add",
      data: {
        name: c.name,
        age: c.age,
        occupation: c.occupation,
        characteristics: c.characteristics,
        ...(c.hp !== undefined ? { hp: c.hp } : {}),
        ...(c.san !== undefined ? { san: c.san } : {}),
        skills: [...merged].map(([name, value]) => ({ name, value, grown: false })),
        notes: c.notes ?? "",
        backstory: c.backstory ?? "",
        possessions: "",
        weapons: [],
      },
    });
  }

  for (const h of sc.handouts) {
    const note = splitNoteTitle(h.title);
    const ev = await kp.send({ type: "handout.create", data: { title: note.title, body: h.body, visibleTo: h.visibleTo, ...(note.kpOnly ? { kpOnly: true } : {}) } });
    const added = ev.find((e) => e.type === "handout.added");
    if (!added || added.type !== "handout.added") throw new Error(`핸드아웃을 만들지 못했어요: ${h.title}`);
    handoutId.set(h.key, added.data.id);
  }

  let flow: Flow | undefined;
  for (const b of sc.beats) {
    const ev = await kp.send({
      type: "flow.beat.upsert",
      data: {
        name: b.name,
        kind: b.kind,
        memo: b.memo,
        ...(b.scene ? { sceneId: sceneId.get(b.scene)! } : {}),
        handoutIds: b.handouts.map((k) => handoutId.get(k)!),
        ...(b.sanReward ? { sanReward: b.sanReward } : {}),
        ...(b.bgm ? { bgmTrackId: trackId.get(b.bgm)! } : {}),
      },
    });
    const upd = ev.find((e) => e.type === "flow.updated");
    if (!upd || upd.type !== "flow.updated") throw new Error(`비트를 만들지 못했어요: ${b.name}`);
    flow = upd.data.flow;
    beatId.set(b.key, flow.beats[flow.beats.length - 1]!.id);
  }
  for (const br of sc.branches) {
    await kp.send({ type: "flow.branch.upsert", data: { from: beatId.get(br.from)!, to: beatId.get(br.to)!, label: br.label, condition: { type: "manual" } } });
  }

  kp.close();
  console.log(`룸 ${josa(`"${created.name}"`, "을/를")} 만들었어요.`);
  console.log(`  룸 id: ${created.id}`);
  console.log(`  초대 코드: ${created.invite.code}`);
  console.log(`  장면 ${sc.scenes.length} · 토큰 ${sc.tokens.length} · NPC 시트 ${sc.characters.length} · 핸드아웃 ${sc.handouts.length} · 비트 ${sc.beats.length} · 분기 ${sc.branches.length}`);
  if (sc.madnessTable || sc.audio) console.log(`  광기표 ${sc.madnessTable?.length ?? 0}줄 · 음원 ${sc.audio?.length ?? 0}개`);
  console.log(`  웹에서 "${user}"(으)로 로그인하면 내 룸에 보여요: /room/${created.id}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
