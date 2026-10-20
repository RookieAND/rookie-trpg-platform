"use client";
import { useState, type ReactNode } from "react";
import { FileDown, FileInput, FileOutput, Pencil } from "lucide-react";
import { exportRoom, renameRoom, type ScenarioImportResult } from "@/entities/room";
import { ApiError, type Caller } from "@/shared/api";
import { downloadText } from "@/shared/lib";
import { useAsk } from "@/shared/ui";
import { ScenarioImportDialog } from "../ui/ScenarioImportDialog";
import { safeFileName } from "./preview";

/**
 * 룸 설정 메뉴의 "준비" 항목들(GM): 시나리오 가져오기, 룸 내보내기, 시나리오 파일로 내보내기, 룸 이름 바꾸기.
 * 메뉴 밖에서 대화상자를 그려야 메뉴가 닫혀도 창이 남으므로, 항목(items)과 창(node)을 따로 돌려준다.
 */
export function useScenarioPrep({ me, roomId, roomName, onRenamed, notify, onImported }: { me: Caller; roomId: string; roomName: string; onRenamed: (name: string) => void; notify: (text: string) => void; onImported: (r: ScenarioImportResult) => void }) {
  const ask = useAsk();
  const [importing, setImporting] = useState(false);
  const [withSheets, setWithSheets] = useState(false);
  const fail = (e: unknown, fallback: string) => notify(e instanceof ApiError ? e.message : fallback);

  const download = async (format: "backup" | "scenario") => {
    try {
      const { text, notes } = await exportRoom(me, roomId, format, format === "backup" ? withSheets : true);
      downloadText(safeFileName(roomName, format === "backup" ? "백업" : "시나리오"), text, "application/json;charset=utf-8");
      notify(notes.length ? `파일을 저장했어요. ${notes.join(" ")}` : "파일을 저장했어요.");
    } catch (e) {
      fail(e, "내보내지 못했어요. 잠시 뒤에 다시 해 주세요.");
    }
  };

  const rename = async () => {
    const next = await ask.prompt({ title: "룸 이름 바꾸기", label: "룸 이름", initial: roomName, maxLength: 60, confirmLabel: "바꾸기" });
    if (!next) return;
    try {
      onRenamed((await renameRoom(me, roomId, next)).name);
    } catch (e) {
      fail(e, "이름을 바꾸지 못했어요.");
    }
  };

  const items = (close: () => void): ReactNode => (
    <>
      <button className="btn" data-testid="menu-import" title="시나리오 파일이나 룸 백업을 이 룸에 더해요" onClick={() => (close(), setImporting(true))}><FileInput aria-hidden />시나리오 가져오기</button>
      <button className="btn" data-testid="menu-export-backup" title="장면·토큰·핸드아웃·흐름·설정을 파일 하나로 저장해요. 새 룸을 만들 때 쓸 수 있어요" onClick={() => void download("backup")}><FileDown aria-hidden />룸 내보내기 (백업)</button>
      <label className="check" style={{ padding: "2px 8px 4px 26px", fontSize: 12 }} title="PL의 시트도 백업에 담아요. 복원하면 GM 소유의 시트로 들어와요">
        <input type="checkbox" data-testid="export-sheets" checked={withSheets} onChange={(e) => setWithSheets(e.target.checked)} style={{ accentColor: "#7c86f7" }} />
        시트 포함
      </label>
      <button className="btn" data-testid="menu-export-scenario" title="다른 룸에서 가져오기 쉬운 시나리오 파일로 저장해요" onClick={() => void download("scenario")}><FileOutput aria-hidden />시나리오 파일로 내보내기</button>
      <button className="btn" data-testid="menu-rename-room" onClick={() => (close(), void rename())}><Pencil aria-hidden />룸 이름 바꾸기</button>
    </>
  );

  const node: ReactNode = (
    <>
      {ask.node}
      {importing && (
        <ScenarioImportDialog
          me={me}
          roomId={roomId}
          onClose={() => setImporting(false)}
          onImported={onImported}
        />
      )}
    </>
  );
  return { items, node };
}
