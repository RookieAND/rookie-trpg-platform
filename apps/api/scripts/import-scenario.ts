/**
 * 시나리오 파일(JSON)을 룸 하나로 옮긴다: 장면, 소품·NPC 토큰, NPC 시트, 핸드아웃, 세션 흐름(비트·분기).
 * KP가 직접 룸을 만든 것처럼 서버에 명령을 보내므로 저장소(파일/Postgres)와 상관없이 같은 방식으로 저장된다.
 *
 * 사용법(서버가 켜져 있어야 한다):
 *   pnpm import:scenario <시나리오.json> [--user 이름] [--api http://localhost:8787] [--room 룸이름]
 *
 * 개발용 로그인에서는 이름이 곧 신원이다. 웹 로비에서 같은 이름으로 로그인하면 룸이 "내 룸"에 보인다.
 */
import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { defaultSkillValues, type ClientCommand, type Flow, type Scene, type ServerMessage, type Snapshot } from "@coc-vtt/shared";

interface ScenarioFile {
  format: string;
  version: number;
  roomName: string;
  scenes: Array<{ key: string; name: string; start?: boolean }>;
  tokens: Array<{ scene: string; kind: "token" | "prop"; name: string; x: number; y: number; layer: "background" | "object" | "gm"; visibleTo: "all" | "gm" }>;
  characters: Array<{
    name: string;
    age: number;
    occupation: string;
    characteristics: Record<"STR" | "CON" | "SIZ" | "DEX" | "APP" | "INT" | "POW" | "EDU", number>;
    hp?: number;
    san?: number;
    skills: Array<{ name: string; value: number }>;
    notes?: string;
    backstory?: string;
  }>;
  handouts: Array<{ key: string; title: string; body: string; visibleTo: "all" | "gm" }>;
  beats: Array<{ key: string; name: string; kind: "start" | "progress" | "ending"; scene?: string; handouts: string[]; memo: string; sanReward?: string }>;
  branches: Array<{ from: string; to: string; label: string }>;
}

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

  const userId = user.trim().toLowerCase().replace(/\s+/g, "-");
  const enc = encodeURIComponent;
  const headers = { "content-type": "application/json", "x-dev-user": enc(userId), "x-dev-name": enc(user) };

  const res = await fetch(`${api}/rooms`, { method: "POST", headers, body: JSON.stringify({ name: room ?? sc.roomName }) });
  if (!res.ok) throw new Error(`룸을 만들지 못했어요(${res.status}): ${await res.text()}`);
  const created = (await res.json()) as { id: string; name: string; invite: { code: string } };

  const wsUrl = `${api.replace(/^http/, "ws")}/ws?${new URLSearchParams({ room: created.id, user: userId, name: user })}`;
  const kp = new Kp(wsUrl);
  await kp.open();

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
    const ev = await kp.send({ type: "handout.create", data: { title: h.title, body: h.body, visibleTo: h.visibleTo, ...(h.title.startsWith("[KP]") ? { kpOnly: true } : {}) } });
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
  console.log(`룸 "${created.name}"을(를) 만들었어요.`);
  console.log(`  룸 id: ${created.id}`);
  console.log(`  초대 코드: ${created.invite.code}`);
  console.log(`  장면 ${sc.scenes.length} · 토큰 ${sc.tokens.length} · NPC 시트 ${sc.characters.length} · 핸드아웃 ${sc.handouts.length} · 비트 ${sc.beats.length} · 분기 ${sc.branches.length}`);
  console.log(`  웹에서 "${user}"(으)로 로그인하면 내 룸에 보여요: /room/${created.id}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
