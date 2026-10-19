import { buildExport } from "@coc-vtt/room-core";
import { classifyRef, MAX_EMBEDDED_BYTES, MAX_EMBEDDED_FILES, type ScenarioDoc } from "@coc-vtt/shared";
import { collectMediaIds } from "../../media-refs";
import type { LoadedRoom } from "./room-registry";

/**
 * 한 사람이 한 시간에 시나리오·백업을 보낼 수 있는 횟수. 미리보기(dryRun)도 센다.
 * 미리보기 뒤 가져오기가 한 쌍이라서 20번 가져올 수 있는 셈이다.
 */
export const IMPORTS_PER_HOUR = 40;
/** 서버 전체에서 동시에 읽고 검사할 수 있는 가져오기 수(메모리 보호). */
export const MAX_CONCURRENT_IMPORTS = 4;
/** 요청 본문 한도(데이터 주소를 품은 파일). 품은 이미지는 MAX_EMBEDDED_BYTES까지라 이 안에 들어온다. */
export const MAX_SCENARIO_BODY = 12 * 1024 * 1024;
/** 내보내는 파일에 이미지를 품을 수 있는 크기 합(가져오기 한도 안에 들어오게 본문 한도보다 작다) */
const EXPORT_EMBED_BYTES = 8 * 1024 * 1024;

type MediaKind = "image" | "audio";
/** 파일을 저장하는 사람(올리기와 같은 시간당 한도를 센다) */
export interface MediaUploader {
  userId: string;
  ip?: string;
}

/** 룸 하나가 가질 수 있는 이미지·오디오 파일 수. 가져오기로 이 수를 넘겨 저장소를 채우지 못하게 한다. */
export const MAX_ROOM_MEDIA_FILES = 200;

/**
 * 이 서비스가 파일 저장소에 바라는 일(포트). 실제 구현(이미지 서비스)은 app.module에서 이어 준다.
 * 룸 컨텍스트가 이미지 컨텍스트를 직접 가져오지 않게 하려는 경계다.
 */
export interface MediaFiles {
  inspect(bytes: Buffer, kind: MediaKind): "ok" | "empty" | "too_large" | "bad_type" | "bad_size";
  storeChecked(bytes: Buffer, kind: MediaKind, who?: MediaUploader): Promise<{ ok: true; id: string } | { ok: false; code: "empty" | "too_large" | "bad_type" | "bad_size" | "rate_limited" }>;
  exists(id: string, kind: MediaKind): Promise<boolean>;
  copy(id: string, kind: MediaKind, who?: MediaUploader): Promise<string | null | "rate_limited">;
  get(id: string, kind?: MediaKind): Promise<{ bytes: Buffer; mime: string } | null>;
  removeMany(ids: Iterable<string>): Promise<number>;
}

const MAX_AUDIO_NOTE = "음원 파일은 담기지 않고 id만 적혀요.";

export interface Resolved {
  doc: ScenarioDoc;
  /** 이미지·음원을 못 쓴 이유 */
  warnings: string[];
  /** 이번에 새로 저장한 파일 id (가져오기가 실패하면 치운다) */
  created: string[];
}

const REASON = {
  empty: "빈 파일이에요",
  too_large: "너무 커요(이미지 3MB, 오디오 10MB까지)",
  bad_size: "그림 크기가 너무 커요(한 변 8000px, 4천만 화소까지)",
  rate_limited: "올릴 수 있는 한도를 넘었어요. 잠시 뒤에 다시 가져와 주세요",
  bad_type: "형식을 알 수 없어요(이미지는 PNG·JPG·GIF·WEBP만 돼요)",
} as const;

const decode = (base64: string): Buffer => Buffer.from(base64, "base64");

/**
 * 시나리오·백업 파일을 룸에 넣기 전후의 서버 쪽 일.
 *  - 파일 속 이미지·음원 참조를 서버에 저장된 파일의 id로 바꾼다(데이터 주소는 형식·크기를 확인해 새로 저장하고,
 *    다른 곳의 id는 새 id로 복사한다. 그래야 한 룸을 지워도 다른 룸의 파일이 같이 지워지지 않는다).
 *  - 룸을 파일로 내보낼 때 이미지를 품는다.
 * 룸 안의 규칙(한도, 소유자 찾기 등)은 room-core가 맡는다.
 */
export class ScenarioService {
  private readonly recent = new Map<string, number[]>();
  /** 지금 가져오기를 처리 중인 사용자. 한 사람이 동시에 하나만 보낼 수 있다. */
  private readonly busy = new Set<string>();

  constructor(
    private readonly images: MediaFiles,
    private readonly now: () => number = Date.now,
  ) {}

  /** 한 시간에 IMPORTS_PER_HOUR번까지. 부르면 한 번 센다. */
  tooMany(userId: string): boolean {
    const t = this.now();
    const hits = (this.recent.get(userId) ?? []).filter((x) => t - x < 3_600_000);
    if (hits.length >= IMPORTS_PER_HOUR) {
      this.recent.set(userId, hits);
      return true;
    }
    hits.push(t);
    this.recent.set(userId, hits);
    return false;
  }

  /**
   * 가져오기 자리를 잡는다. 이 사용자가 이미 처리 중이면 "user", 서버 전체가 꽉 찼으면 "server", 잡았으면 release 함수를 준다.
   * 본문을 읽기 전에 잡고, 끝나면(성공이든 실패든) 꼭 release를 불러야 한다.
   */
  begin(userId: string): { ok: true; release: () => void } | { ok: false; reason: "user" | "server" } {
    if (this.busy.has(userId)) return { ok: false, reason: "user" };
    if (this.busy.size >= MAX_CONCURRENT_IMPORTS) return { ok: false, reason: "server" };
    this.busy.add(userId);
    let done = false;
    return {
      ok: true,
      release: () => {
        if (done) return;
        done = true;
        this.busy.delete(userId);
      },
    };
  }

  /**
   * 참조를 id로 바꾼다. store가 false면(미리보기) 아무것도 저장하지 않고 쓸 수 있는지만 본다.
   * roomMedia는 이 룸이 이미 쓰는 파일 id: 이런 id는 복사하지 않고 그대로 쓴다.
   */
  async resolve(doc: ScenarioDoc, opts: { roomMedia: ReadonlySet<string>; store: boolean; who?: MediaUploader }): Promise<Resolved> {
    const warnings: string[] = [];
    const created: string[] = [];
    const cache = new Map<string, Promise<string | undefined>>();
    const note = (m: string) => warnings.includes(m) || warnings.push(m);
    const placeholder = "0".repeat(32);

    const one = (ref: string, kind: "image" | "audio", where: string): Promise<string | undefined> => {
      const memo = `${kind}:${ref}`;
      const hit = cache.get(memo);
      if (hit) return hit;
      const run = (async (): Promise<string | undefined> => {
        const c = classifyRef(ref);
        if (c.kind === "file") {
          note(`${where}: 파일 경로는 웹에서 쓸 수 없어서 건너뛰었어요. 이미지는 데이터 주소나 올려 둔 id로 적어 주세요.`);
          return undefined;
        }
        let bytes: Buffer | null = null;
        if (c.kind === "data") bytes = decode(c.base64);
        else if (doc.media && Object.hasOwn(doc.media, c.id)) {
          const m = classifyRef(doc.media[c.id]!);
          if (m.kind === "data") bytes = decode(m.base64);
        }
        if (bytes) {
          const verdict = this.images.inspect(bytes, kind);
          if (verdict !== "ok") {
            note(`${where}: ${REASON[verdict]}. 건너뛰었어요.`);
            return undefined;
          }
          if (!opts.store) return placeholder;
          if (opts.roomMedia.size + created.length >= MAX_ROOM_MEDIA_FILES) {
            note(`${where}: 룸에 둘 수 있는 파일 수(${MAX_ROOM_MEDIA_FILES}개)를 넘어서 건너뛰었어요.`);
            return undefined;
          }
          const stored = await this.images.storeChecked(bytes, kind, opts.who);
          if (!stored.ok) {
            if (stored.code !== "empty") note(`${where}: ${REASON[stored.code]}. 건너뛰었어요.`);
            return undefined;
          }
          created.push(stored.id);
          return stored.id;
        }
        const id = (c as { id: string }).id;
        if (opts.roomMedia.has(id) && (await this.images.exists(id, kind))) return id;
        if (!opts.store) return (await this.images.exists(id, kind)) ? id : (note(`${where}: 올려 둔 파일을 찾을 수 없어서 건너뛰었어요.`), undefined);
        if (opts.roomMedia.size + created.length >= MAX_ROOM_MEDIA_FILES) {
          note(`${where}: 룸에 둘 수 있는 파일 수(${MAX_ROOM_MEDIA_FILES}개)를 넘어서 건너뛰었어요.`);
          return undefined;
        }
        const copy = await this.images.copy(id, kind, opts.who);
        if (copy === "rate_limited") {
          note(`${where}: ${REASON.rate_limited}. 건너뛰었어요.`);
          return undefined;
        }
        if (!copy) {
          note(`${where}: 올려 둔 파일을 찾을 수 없어서 건너뛰었어요.`);
          return undefined;
        }
        created.push(copy);
        return copy;
      })();
      cache.set(memo, run);
      return run;
    };

    const out: ScenarioDoc = JSON.parse(JSON.stringify({ ...doc, media: undefined })) as ScenarioDoc;
    for (const s of out.scenes) if (s.background) s.background = await one(s.background, "image", `장면 '${s.name}'의 배경`);
    for (const t of out.tokens) if (t.image) t.image = await one(t.image, "image", `토큰 '${t.name}'의 이미지`);
    for (const h of out.handouts) if (h.image) h.image = await one(h.image, "image", `핸드아웃 '${h.title}'의 이미지`);
    for (const a of out.audio ?? []) {
      if (a.data) {
        a.assetId = await one(a.data, "audio", `음원 '${a.label}'`);
        delete a.data;
      } else if (a.assetId) {
        a.assetId = await one(a.assetId, "audio", `음원 '${a.label}'`);
      }
      // file(CLI 전용)은 여기서 쓸 수 없다. 룸이 "파일이 없어서 건너뛰었어요"로 알린다.
      delete a.file;
    }
    return { doc: out, warnings, created };
  }

  /** 룸의 현재 상태를 파일로 만든다. 이미지는 크기 한도 안에서 품고, 못 품은 것은 notes로 알린다. */
  async exportRoom(entry: LoadedRoom, opts: { format: "scenario" | "backup"; sheets: boolean }): Promise<{ doc: ScenarioDoc; notes: string[] }> {
    const data = entry.room.toData();
    const doc = buildExport(data, { format: opts.format, sheets: opts.sheets, roomName: entry.meta.name, exportedAt: new Date(this.now()).toISOString() });
    const ids = new Set<string>();
    for (const s of doc.scenes) if (s.background) ids.add(s.background);
    for (const t of doc.tokens) if (t.image) ids.add(t.image);
    for (const h of doc.handouts) if (h.image) ids.add(h.image);
    const media: Record<string, string> = {};
    const notes: string[] = [];
    let bytes = 0;
    let skipped = 0;
    for (const id of ids) {
      const file = await this.images.get(id, "image");
      if (!file) {
        skipped += 1;
        continue;
      }
      const size = Math.ceil((file.bytes.length * 4) / 3);
      if (bytes + size > Math.min(EXPORT_EMBED_BYTES, MAX_EMBEDDED_BYTES) || Object.keys(media).length >= MAX_EMBEDDED_FILES) {
        skipped += 1;
        continue;
      }
      bytes += size;
      media[id] = `data:${file.mime};base64,${file.bytes.toString("base64")}`;
    }
    if (Object.keys(media).length) doc.media = media;
    if (skipped) notes.push(`이미지 ${skipped}개는 파일에 담지 못했어요(없거나 너무 커요).`);
    if (doc.audio?.length) notes.push(MAX_AUDIO_NOTE);
    return { doc, notes };
  }

  /** 룸이 쓰는 파일 id들 */
  mediaOf(entry: LoadedRoom): Set<string> {
    return collectMediaIds(entry.room.toData());
  }

  /** 가져오기가 실패했을 때, 이번에 새로 저장한 파일을 치운다. */
  async discard(created: string[]): Promise<void> {
    await this.images.removeMany(created);
  }
}
