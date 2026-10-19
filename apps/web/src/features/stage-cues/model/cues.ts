import type { ClientCommand, GameObject, Handout, Scene } from "@coc-vtt/shared";

/** 연출 바와 명령어 검색이 부르는 동작 하나. id는 장면·핸드아웃·오브젝트 id로 만들어 슬롯에 저장해도 안 바뀐다. */
interface CueBase {
  id: string;
  group: "scene" | "handout" | "object" | "action";
  label: string;
  /** 검색에만 쓰는 추가 단어 */
  keywords: string;
}
/** 서버에 보내는 명령이거나(command), 화면에서 여는 동작(run: NPC 만들기 창 같은 것) 중 하나다. */
export type Cue = CueBase & ({ command: ClientCommand; run?: undefined } | { run: () => void; command?: undefined });

/** 화면의 동작을 명령어 검색에 올린다. 슬롯에 등록해 두면 숫자 키로도 부른다. */
export interface CueAction {
  id: string;
  label: string;
  keywords: string;
  run: () => void;
}

export interface CueSource {
  scenes: Scene[];
  activeSceneId: string;
  handouts: Handout[];
  /** GM이 지금 보고 있는 장면의 토큰·소품 */
  objects: GameObject[];
  /** 명령이 아닌 화면 동작(토큰으로 놓기, NPC 만들기 …) */
  actions?: CueAction[];
}

export function buildCues({ scenes, activeSceneId, handouts, objects, actions = [] }: CueSource): Cue[] {
  const cues: Cue[] = actions.map((a) => ({ id: a.id, group: "action", label: a.label, keywords: a.keywords, run: a.run }));
  for (const s of scenes) {
    if (s.id === activeSceneId) continue;
    cues.push({ id: `scene:${s.id}:cut`, group: "scene", label: `장면 전환 · ${s.name} (바로)`, keywords: "scene 장면 컷 cut", command: { type: "scene.activate", data: { id: s.id, transition: "cut" } } });
    cues.push({ id: `scene:${s.id}:fade`, group: "scene", label: `장면 전환 · ${s.name} (페이드)`, keywords: "scene 장면 페이드 fade", command: { type: "scene.activate", data: { id: s.id, transition: "fade" } } });
  }
  for (const h of handouts) {
    if (h.visibleTo === "gm") {
      cues.push({ id: `handout:${h.id}:publish`, group: "handout", label: `핸드아웃 전원 공개 · ${h.title}`, keywords: "handout 핸드아웃 공개", command: { type: "handout.update", data: { id: h.id, visibleTo: "all" } } });
    } else {
      cues.push({ id: `handout:${h.id}`, group: "handout", label: `핸드아웃 펼치기 · ${h.title}`, keywords: "handout 핸드아웃 펼치기", command: { type: "handout.show", data: { id: h.id } } });
    }
  }
  for (const o of objects) {
    const hidden = o.layer === "gm";
    cues.push({
      id: `object:${o.id}`,
      group: "object",
      label: `${o.kind === "token" ? "토큰" : "소품"} ${hidden ? "공개" : "숨기기"} · ${o.name}`,
      keywords: "object 토큰 소품 숨기기 공개",
      command: { type: "object.update", data: { id: o.id, layer: hidden ? "object" : "gm" } },
    });
  }
  return cues;
}

/** 공백으로 나눈 단어가 모두 들어 있는 항목만, 이름이 단어로 시작하는 것을 먼저 보여 준다. */
export function filterCues(cues: Cue[], query: string): Cue[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return cues;
  const scored: Array<{ cue: Cue; score: number }> = [];
  for (const cue of cues) {
    const hay = `${cue.label} ${cue.keywords}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const name = cue.label.toLowerCase().split(" · ")[1] ?? "";
    scored.push({ cue, score: words.some((w) => name.startsWith(w)) ? 0 : 1 });
  }
  return scored.sort((a, b) => a.score - b.score).map((x) => x.cue);
}

/** 숫자 키로 장면을 바꾸기 전에 취소할 수 있게 기다려 주는 시간(ms) */
export const SLOT_CONFIRM_MS = 3000;

/**
 * 숫자 키로 부른 동작을 바로 하지 않고 한 줄로 알린 뒤 기다려야 하는가.
 * 세션이 진행 중일 때 장면을 바꾸는 동작만 해당한다(PL 화면이 한꺼번에 바뀌므로). 아니면 null.
 */
export function slotConfirm(cue: Pick<Cue, "label" | "command">, sessionActive: boolean): { text: string } | null {
  if (!sessionActive || cue.command?.type !== "scene.activate") return null;
  const name = (cue.label.split(" · ")[1] ?? "").replace(/ \((바로|페이드)\)$/, "");
  return { text: `장면 전환: ${name} · ${SLOT_CONFIRM_MS / 1000}초 뒤` };
}
