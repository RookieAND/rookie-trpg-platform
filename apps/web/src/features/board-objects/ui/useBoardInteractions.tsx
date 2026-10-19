"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ClientCommand, GameObject } from "@coc-vtt/shared";
import { firstImageFile, imageFormatError, uploadImageFile, type Caller } from "@/shared/api";
import { duplicateCommand } from "../model/object-actions";
import { intakeCommand, nameFromFile, type IntakeChoice } from "../model/intake";
import { uniqueName } from "../model/names";
import { boardKeyAction, isTyping, nextTokenId } from "../model/shortcuts";
import { ImageIntakePopover, ObjectImagePopover } from "./ImageIntakePopover";
import { ObjectContextMenu } from "./ObjectContextMenu";

const OVERLAY = '[role="dialog"],[role="menu"],[aria-modal="true"],[data-overlay]';

interface Input {
  me: Caller;
  /** GM만 오브젝트를 지우고 바꿀 수 있다(서버도 같다). 아니면 Esc·Tab 선택 이동만 쓴다. */
  isKp: boolean;
  /** 지금 보고 있는 장면과 그 장면의 오브젝트 */
  sceneId: string;
  objects: GameObject[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 되돌릴 수 있는 삭제에 안내 토스트를 붙이는 send */
  send: (c: ClientCommand) => unknown;
  notify: (text: string) => void;
  /** 올린 이미지를 '이미지 고르기' 목록에 기억한다 */
  remember: (id: string) => void;
}

/**
 * 보드의 키보드·오른쪽 클릭 메뉴·이미지 끌어놓기·붙여넣기를 한곳에서 맡는다.
 * 돌려주는 ui 는 룸 화면에 그대로 그려 넣고, 나머지는 Board 의 속성으로 넘긴다.
 */
export function useBoardInteractions({ me, isKp, sceneId, objects, selectedId, onSelect, send, notify, remember }: Input) {
  const [menu, setMenu] = useState<{ id: string; cx: number; cy: number } | null>(null);
  const [pick, setPick] = useState<{ id: string; cx: number; cy: number } | null>(null);
  const [intake, setIntake] = useState<{ file: File; x: number; y: number; cx: number; cy: number } | null>(null);
  // 새로 만든 오브젝트를 이름으로 찾아 선택하려고 기다리는 중
  const awaiting = useRef<string | null>(null);
  const live = useRef({ objects, selectedId, sceneId });
  live.current = { objects, selectedId, sceneId };

  const selected = objects.find((o) => o.id === selectedId);

  useEffect(() => {
    const name = awaiting.current;
    if (!name) return;
    const made = objects.find((o) => o.name === name);
    if (made) {
      awaiting.current = null;
      onSelect(made.id);
    }
  }, [objects, onSelect]);
  useEffect(() => setMenu(null), [sceneId]);

  const takenNames = () => live.current.objects.map((o) => o.name);

  const remove = useCallback(
    (o: GameObject) => {
      send({ type: "object.remove", data: { id: o.id } });
      onSelect(null);
    },
    [send, onSelect],
  );
  const duplicate = useCallback(
    (o: GameObject) => {
      const d = duplicateCommand(o, takenNames());
      awaiting.current = d.name;
      send(d.command);
      setTimeout(() => {
        if (awaiting.current === d.name) awaiting.current = null;
      }, 3000);
    },
    [send],
  );

  // 키보드: 지우기(Delete·Backspace), 복제(Ctrl+D), 선택 해제(Esc), 토큰 사이 이동(Tab)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // 메뉴·상자가 이미 이 키(Esc 등)를 썼다
      const { objects: list, selectedId: sid } = live.current;
      const sel = list.find((o) => o.id === sid);
      const action = boardKeyAction(e, { canEdit: isKp, hasSelection: Boolean(sel), overlayOpen: Boolean(document.querySelector(OVERLAY)) });
      if (!action || !sel) return;
      e.preventDefault();
      if (action.type === "delete") remove(sel);
      else if (action.type === "duplicate") duplicate(sel);
      else if (action.type === "deselect") onSelect(null);
      else {
        const next = nextTokenId(list.filter((o) => o.kind === "token").map((o) => o.id), sel.id, action.dir);
        if (next) onSelect(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isKp, remove, duplicate, onSelect]);

  const bad = useCallback(
    (file: File) => {
      const msg = imageFormatError(file);
      if (msg) notify(msg);
      return Boolean(msg);
    },
    [notify],
  );

  /** 토큰 위에 놓으면 바로 그 이미지로, 빈 곳이면 쓰임을 묻는다. */
  const onImageFile = useCallback(
    async (file: File, hit: { objectId: string | null; x: number; y: number; cx: number; cy: number }) => {
      if (!isKp || bad(file)) return;
      const target = hit.objectId ? live.current.objects.find((o) => o.id === hit.objectId) : undefined;
      if (!target) return void setIntake({ file, x: hit.x, y: hit.y, cx: hit.cx, cy: hit.cy });
      try {
        const id = await uploadImageFile(me, file);
        remember(id);
        send({ type: "object.update", data: { id: target.id, image: id } });
        onSelect(target.id);
        notify(`‘${target.name}’ 이미지를 바꿨어요`);
      } catch (err) {
        notify(err instanceof Error ? err.message : "이미지를 올리지 못했어요.");
      }
    },
    [isKp, bad, me, remember, send, onSelect, notify],
  );

  // 클립보드의 이미지 붙여 넣기: 글을 쓰는 중이거나 대화상자가 열려 있으면 건드리지 않는다.
  useEffect(() => {
    if (!isKp) return;
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || document.querySelector(OVERLAY)) return;
      const file = firstImageFile(e.clipboardData?.files);
      if (!file) return;
      e.preventDefault();
      const r = document.getElementById("game-board")?.getBoundingClientRect();
      void onImageFile(file, { objectId: null, x: 500, y: 400, cx: r ? r.left + r.width / 2 - 80 : 200, cy: r ? r.top + r.height / 2 - 70 : 200 });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [isKp, onImageFile]);

  const finishIntake = (choice: IntakeChoice, image: string) => {
    if (!intake) return;
    const kindName = choice === "prop" ? "소품" : "토큰";
    const name = uniqueName(nameFromFile(intake.file.name, kindName), takenNames());
    const cmd = intakeCommand(choice, { image, sceneId, x: intake.x, y: intake.y, name, ...(selected ? { selectedId: selected.id } : {}) });
    if (cmd) {
      if (cmd.type === "object.add") awaiting.current = name;
      send(cmd);
      notify({ background: "배경을 정했어요", token: "새 토큰을 놓았어요", prop: "소품을 놓았어요", selected: "이미지를 바꿨어요" }[choice]);
    }
    setIntake(null);
  };

  const menuObj = menu ? objects.find((o) => o.id === menu.id) : undefined;
  const pickObj = pick ? objects.find((o) => o.id === pick.id) : undefined;

  const ui: ReactNode = isKp ? (
    <>
      {menu && menuObj && (
        <ObjectContextMenu
          obj={menuObj}
          at={menu}
          send={send}
          onClose={() => setMenu(null)}
          actions={{
            onRename: (name) => send({ type: "object.update", data: { id: menuObj.id, name } }),
            onDuplicate: () => duplicate(menuObj),
            onToggleHidden: () => send({ type: "object.update", data: { id: menuObj.id, layer: menuObj.layer === "gm" ? "object" : "gm" } }),
            onToggleLock: () => send({ type: "object.update", data: { id: menuObj.id, locked: !menuObj.locked } }),
            onChangeImage: (cx, cy) => setPick({ id: menuObj.id, cx, cy }),
            onDelete: () => remove(menuObj),
          }}
        />
      )}
      {pick && pickObj && (
        <ObjectImagePopover
          me={me}
          current={pickObj.image}
          at={pick}
          onClose={() => setPick(null)}
          onPick={(image) => {
            send({ type: "object.update", data: { id: pickObj.id, image } });
            setPick(null);
          }}
        />
      )}
      {intake && <ImageIntakePopover me={me} file={intake.file} at={intake} {...(selected ? { selected } : {})} onClose={() => setIntake(null)} onChoose={finishIntake} />}
    </>
  ) : null;

  return {
    ui,
    /** Board 속성으로 넘긴다. GM이 아니면 undefined */
    boardProps: isKp
      ? {
          onImageFile,
          onObjectMenu: (o: GameObject, cx: number, cy: number) => {
            onSelect(o.id);
            setMenu({ id: o.id, cx, cy });
          },
          onRequestImage: (o: GameObject, cx: number, cy: number) => setPick({ id: o.id, cx, cy }),
        }
      : {},
  };
}
