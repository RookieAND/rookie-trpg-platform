import { BACKUP_FORMAT, BACKUP_VERSION, BGM_STOP, SCENARIO_FORMAT, SCENARIO_VERSION, type Branch, type ScenarioDoc } from "@coc-vtt/shared";
import type { RoomData } from "./room";

export interface ExportOptions {
  /** scenario: 다른 룸에서 다시 쓰는 파일. backup: 설정(효과)까지 담은 룸 통째 백업 */
  format: "scenario" | "backup";
  /** 캐릭터 시트(NPC와 PC)를 담을지 */
  sheets: boolean;
  roomName: string;
  /** 파일에 적을 시각(ISO 문장) */
  exportedAt: string;
}

/**
 * 룸의 저장 상태를 시나리오·백업 문서로 바꾼다. 룸의 id는 모두 파일 안의 이름표(key)로 바뀌고,
 * 사용자 id·디스코드 웹훅 같은 비밀은 담지 않는다. 토큰의 소유자와 핸드아웃의 공개 대상은 "그 PL의 캐릭터 이름"
 * (시트가 없으면 PL1·PL2 같은 순번)으로 적어서, 가져올 때 새 룸의 PL에게 다시 맞춘다.
 * 이미지·음원은 id를 그대로 적는다. 이미지 데이터를 품는 일(media)은 파일에 접근할 수 있는 서버가 한다.
 * GM 전용 노트와 숨긴 오브젝트도 그대로 담는다(GM이 받는 파일이다).
 */
export function buildExport(data: RoomData, opts: ExportOptions): ScenarioDoc {
  const scenes = data.scenes?.length ? data.scenes : [{ id: "main", name: "장면 1" }];
  const sceneKey = new Map(scenes.map((s, i) => [s.id, `s${i + 1}`]));
  const audio = data.audio ?? [];
  const trackKey = new Map(audio.map((t, i) => [t.id, `a${i + 1}`]));
  const handouts = data.handouts ?? [];
  const handoutKey = new Map(handouts.map((h, i) => [h.id, `h${i + 1}`]));
  const characters = opts.sheets ? (data.characters ?? []) : [];
  const charKey = new Map(characters.map((c, i) => [c.id, `c${i + 1}`]));
  const flow = data.flow ?? { beats: [], branches: [], current: null, suggestions: [] };
  const beatKey = new Map(flow.beats.map((b, i) => [b.id, `b${i + 1}`]));

  // PL을 사람 이름 대신 캐릭터 이름·순번으로 부른다.
  const pls = data.members.filter((m) => m.role === "pl");
  const used = new Set<string>();
  const label = new Map<string, string>();
  pls.forEach((m, i) => {
    const sheet = (data.characters ?? []).find((c) => c.ownerId === m.userId);
    let l = sheet?.name ?? `PL${i + 1}`;
    if (used.has(l)) l = `PL${i + 1}`;
    used.add(l);
    label.set(m.userId, l);
  });

  const bgm = (id: string | undefined) => (id === undefined ? undefined : id === BGM_STOP ? BGM_STOP : trackKey.get(id));
  const opt = <K extends string, V>(k: K, v: V | undefined): Partial<Record<K, V>> => (v === undefined ? {} : ({ [k]: v } as Record<K, V>));

  const doc: ScenarioDoc = {
    format: opts.format === "backup" ? BACKUP_FORMAT : SCENARIO_FORMAT,
    version: opts.format === "backup" ? BACKUP_VERSION : SCENARIO_VERSION,
    roomName: opts.roomName,
    exportedAt: opts.exportedAt,
    scenes: scenes.map((s) => ({
      key: sceneKey.get(s.id)!,
      name: s.name,
      ...(s.start ? { start: true } : {}),
      ...opt("bgm", bgm(s.bgmTrackId)),
      ...opt("background", s.background),
      ...(s.fog ? { fog: { enabled: s.fog.enabled, zones: s.fog.zones.map((z) => ({ x: z.x, y: z.y, r: z.r })) } } : {}),
    })),
    tokens: data.objects
      .filter((o) => sceneKey.has(o.sceneId))
      .map((o) => ({
        scene: sceneKey.get(o.sceneId)!,
        kind: o.kind,
        name: o.name,
        x: o.x,
        y: o.y,
        layer: o.layer,
        visibleTo: o.visibleTo === "all" ? ("all" as const) : ("gm" as const),
        ...opt("owner", o.ownerId ? label.get(o.ownerId) : undefined),
        ...opt("image", o.image),
        ...(o.vision ? { vision: o.vision } : {}),
        ...opt("character", o.characterId ? charKey.get(o.characterId) : undefined),
        ...(o.hpPublic && o.characterId && charKey.has(o.characterId) ? { hpPublic: true } : {}),
        ...(o.locked ? { locked: true } : {}),
      })),
    characters: characters.map((c) => ({
      key: charKey.get(c.id)!,
      name: c.name,
      age: c.age,
      occupation: c.occupation,
      characteristics: { ...c.characteristics },
      luck: c.luck,
      hp: c.hp,
      mp: c.mp,
      san: c.san,
      skills: Object.entries(c.skills).map(([name, v]) => ({ name, value: v.value, ...(v.grown ? { grown: true } : {}) })),
      weapons: (c.weapons ?? []).map((w) => ({ ...w })),
      notes: c.notes,
      backstory: c.backstory ?? "",
      possessions: c.possessions ?? "",
      ...(data.members.find((m) => m.userId === c.ownerId)?.role === "pl" ? { pc: true } : {}),
    })),
    handouts: handouts.map((h) => {
      const to = Array.isArray(h.visibleTo) ? h.visibleTo.flatMap((u) => (label.has(u) ? [label.get(u)!] : [])) : [];
      return {
        key: handoutKey.get(h.id)!,
        title: h.title,
        body: h.body,
        visibleTo: h.visibleTo === "all" ? ("all" as const) : ("gm" as const),
        ...(to.length ? { to } : {}),
        ...opt("image", h.image),
        ...(h.kpOnly ? { kpOnly: true } : {}),
      };
    }),
    beats: flow.beats.map((b) => ({
      key: beatKey.get(b.id)!,
      name: b.name,
      kind: b.kind,
      ...opt("scene", b.sceneId ? sceneKey.get(b.sceneId) : undefined),
      handouts: b.handoutIds.flatMap((h) => (handoutKey.has(h) ? [handoutKey.get(h)!] : [])),
      memo: b.memo,
      ...opt("sanReward", b.sanReward),
      ...opt("bgm", bgm(b.bgmTrackId)),
    })),
    branches: flow.branches.flatMap((br: Branch): ScenarioDoc["branches"] => {
      const from = beatKey.get(br.from);
      const to = beatKey.get(br.to);
      if (!from || !to) return [];
      const c = br.condition;
      if (c.type === "handout") {
        const h = handoutKey.get(c.handoutId);
        return [{ from, to, label: br.label, condition: h ? { type: "handout", handout: h } : { type: "manual" } }];
      }
      return [{ from, to, label: br.label, condition: c }];
    }),
    madnessTable: [...(data.madnessTable ?? [])],
    audio: audio.map((t) => ({ key: trackKey.get(t.id)!, label: t.label, kind: t.kind, assetId: t.assetId, volume: t.volume })),
    ...(opts.format === "backup" && data.effects ? { effects: JSON.parse(JSON.stringify(data.effects)) } : {}),
  };
  return doc;
}
