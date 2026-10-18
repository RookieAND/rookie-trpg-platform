import type { ClientCommand, GameObject } from "@coc-vtt/shared";
import { duplicateSpot } from "./shortcuts";
import { uniqueName } from "./names";

/** 오브젝트를 복제하는 명령과 새 이름. 이름은 겹치지 않게 번호를 붙이고, 소유자는 잇지 않는다(복제본은 NPC). */
export function duplicateCommand(obj: GameObject, takenNames: ReadonlyArray<string>): { command: ClientCommand; name: string } {
  const name = uniqueName(obj.name, takenNames);
  const spot = duplicateSpot(obj.x, obj.y);
  return {
    name,
    command: {
      type: "object.add",
      data: {
        kind: obj.kind,
        name,
        x: Math.round(spot.x),
        y: Math.round(spot.y),
        layer: obj.layer,
        visibleTo: obj.visibleTo,
        sceneId: obj.sceneId,
        ...(obj.image ? { image: obj.image } : {}),
      },
    },
  };
}

/** 떠 있는 상자가 화면 밖으로 나가지 않게 앵커 좌표를 보정한다. */
export function clampToViewport(cx: number, cy: number, w: number, h: number, vw: number, vh: number, margin = 8): { left: number; top: number } {
  return { left: Math.max(margin, Math.min(cx, vw - w - margin)), top: Math.max(margin, Math.min(cy, vh - h - margin)) };
}
