import { collectMediaIds } from "../media-refs";
import { IMAGE_ID, type ImageStorage } from "../image/domain/image-storage";
import type { RoomRepository } from "../room/domain/room.repository";

/**
 * 어떤 저장된 룸도 가리키지 않는 이미지·오디오를 찾아 지운다.
 * 룸을 지우면 딸린 파일은 함께 지워지지만, 올리기만 하고 저장하지 않은 파일이나 서버가 중간에 죽어
 * 못 지운 파일은 남는다. 그런 파일을 주기적으로 치우는 용도다.
 *
 * 안전장치
 *  - 최근 minAgeDays일 안에 올라온 파일은 건드리지 않는다(방금 올리고 아직 룸에 저장하지 않은 파일, 저장 대기 중인 룸).
 *  - 룸이 하나도 없는데 파일만 있으면(엉뚱한 DB에 연결했을 가능성) 아무것도 지우지 않고 멈춘다.
 *  - dryRun이면 지우지 않고 목록만 돌려준다.
 */
export interface CleanupOptions {
  store: RoomRepository;
  images: ImageStorage;
  minAgeDays: number;
  dryRun: boolean;
  now?: () => number;
  /** 한 번에 지울 최대 개수(기본 제한 없음). 실수로 많이 지우는 것을 막는 용도 */
  maxDelete?: number;
  log?: (line: string) => void;
}

export interface CleanupReport {
  rooms: number;
  referenced: number;
  scanned: number;
  tooNew: number;
  unused: string[];
  deleted: number;
  failed: number;
  aborted?: "no_rooms" | "too_many";
}

export async function cleanupUnusedImages(o: CleanupOptions): Promise<CleanupReport> {
  const now = (o.now ?? Date.now)();
  const cutoff = now - o.minAgeDays * 86_400_000;
  const log = o.log ?? (() => {});

  const referenced = new Set<string>();
  let rooms = 0;
  for await (const r of o.store.listAll()) {
    rooms += 1;
    // 룸 데이터뿐 아니라 메타(디스코드 설정 등)까지 훑는다. 조금 넓게 잡는 쪽이 안전하다.
    for (const id of collectMediaIds(r)) referenced.add(id);
  }

  const report: CleanupReport = { rooms, referenced: referenced.size, scanned: 0, tooNew: 0, unused: [], deleted: 0, failed: 0 };
  for await (const f of o.images.list()) {
    if (!IMAGE_ID.test(f.id)) continue;
    report.scanned += 1;
    if (referenced.has(f.id)) continue;
    if (f.createdAt > cutoff) {
      report.tooNew += 1;
      continue;
    }
    report.unused.push(f.id);
  }

  if (rooms === 0 && report.scanned > 0) {
    report.aborted = "no_rooms";
    log("저장된 룸이 하나도 없는데 파일이 있어요. 다른 저장소에 연결했는지 확인해 주세요. 아무것도 지우지 않았어요.");
    return report;
  }
  if (o.maxDelete !== undefined && report.unused.length > o.maxDelete) {
    report.aborted = "too_many";
    log(`지울 파일이 ${report.unused.length}개로 한도(${o.maxDelete}개)를 넘어요. 아무것도 지우지 않았어요.`);
    return report;
  }
  if (o.dryRun) return report;

  for (const id of report.unused) {
    try {
      await o.images.remove(id);
      report.deleted += 1;
    } catch (e) {
      report.failed += 1;
      log(`지우지 못했어요 (${id}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return report;
}
