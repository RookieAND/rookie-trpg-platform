import { errFields, log } from "../platform/log";
import type { ImageStorage } from "../image/domain/image-storage";
import type { RoomRepository } from "../room/domain/room.repository";
import { cleanupUnusedImages, type CleanupReport } from "./cleanup-images";

export interface CleanupScheduleOptions {
  store: RoomRepository;
  images: ImageStorage;
  /** off면 아무것도 하지 않는다. dry-run은 지울 목록만 로그로 남기고, on은 실제로 지운다. */
  mode: "off" | "dry-run" | "on";
  intervalHours: number;
  minAgeDays: number;
  maxDelete: number;
  /** 시작하고 첫 점검까지 기다리는 시간(ms). 기본 10분 */
  firstRunDelayMs?: number;
}

/**
 * 쓰이지 않는 이미지·오디오를 주기적으로 치운다(cleanup:images 스크립트와 같은 로직).
 * 환경변수 IMAGE_CLEANUP=on|dry-run으로 켠다. 기본은 꺼짐이다.
 * 안전장치는 스크립트와 같다: 최근 minAgeDays일 안의 파일은 건드리지 않고, 룸이 하나도 없으면 멈추고, 한 번에 maxDelete개를 넘으면 멈춘다.
 * 돌려주는 함수를 부르면 타이머를 끈다. runNow는 테스트용이다.
 */
export function startCleanupSchedule(o: CleanupScheduleOptions): { stop: () => void; runNow: () => Promise<CleanupReport | null> } {
  let running = false;
  const runNow = async (): Promise<CleanupReport | null> => {
    if (o.mode === "off" || running) return null;
    running = true;
    try {
      const report = await cleanupUnusedImages({
        store: o.store,
        images: o.images,
        minAgeDays: o.minAgeDays,
        dryRun: o.mode !== "on",
        maxDelete: o.maxDelete,
        log: (line) => log.warn(`이미지 정리: ${line}`),
      });
      log.info("이미지 정리를 마쳤어요", {
        mode: o.mode,
        rooms: report.rooms,
        scanned: report.scanned,
        unused: report.unused.length,
        deleted: report.deleted,
        failed: report.failed,
        ...(report.aborted ? { aborted: report.aborted } : {}),
      });
      return report;
    } catch (e) {
      log.error("이미지 정리 실패", errFields(e));
      return null;
    } finally {
      running = false;
    }
  };
  if (o.mode === "off") return { stop: () => {}, runNow };
  const first = setTimeout(() => void runNow(), o.firstRunDelayMs ?? 10 * 60_000);
  const every = setInterval(() => void runNow(), o.intervalHours * 3_600_000);
  first.unref();
  every.unref();
  return {
    stop: () => {
      clearTimeout(first);
      clearInterval(every);
    },
    runNow,
  };
}
