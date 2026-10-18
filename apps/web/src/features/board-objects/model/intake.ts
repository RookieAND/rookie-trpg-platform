import type { ClientCommand } from "@coc-vtt/shared";

/** 빈 보드에 이미지를 놓았을 때 고를 수 있는 쓰임 */
export type IntakeChoice = "background" | "token" | "prop" | "selected";

export interface IntakeOption {
  choice: IntakeChoice;
  label: string;
}

/** 팝오버에 보여 줄 선택지. 토큰이나 소품이 골라져 있으면 그 이미지로 바꾸는 선택지가 맨 위에 붙는다. */
export function intakeOptions(selected?: { name: string }): IntakeOption[] {
  const base: IntakeOption[] = [
    { choice: "background", label: "배경으로" },
    { choice: "token", label: "새 토큰으로" },
    { choice: "prop", label: "소품으로" },
  ];
  if (!selected) return base;
  const name = selected.name.length > 12 ? `${selected.name.slice(0, 12)}…` : selected.name;
  return [{ choice: "selected", label: `‘${name}’ 이미지로` }, ...base];
}

/** 파일 이름에서 오브젝트 이름을 뽑는다. 붙여 넣은 그림의 흔한 이름(image 등)이나 빈 이름이면 fallback. */
export function nameFromFile(fileName: string, fallback: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_]+/g, " ").trim();
  if (!base || /^(image|blob|untitled|clipboard)$/i.test(base)) return fallback;
  return base.slice(0, 36);
}

export interface IntakeContext {
  /** 올라간 이미지 id */
  image: string;
  /** 지금 보고 있는 장면 */
  sceneId: string;
  /** 새 오브젝트를 놓을 보드 좌표 */
  x: number;
  y: number;
  /** 새 오브젝트의 이름(겹치지 않게 정한 것) */
  name: string;
  /** choice가 selected일 때 바꿀 오브젝트 */
  selectedId?: string;
}

/** 선택지에 맞는 서버 명령. selected인데 대상이 없으면 null. */
export function intakeCommand(choice: IntakeChoice, c: IntakeContext): ClientCommand | null {
  switch (choice) {
    case "background":
      return { type: "scene.background", data: { id: c.sceneId, image: c.image } };
    case "selected":
      return c.selectedId ? { type: "object.update", data: { id: c.selectedId, image: c.image } } : null;
    case "token":
    case "prop":
      return { type: "object.add", data: { kind: choice, name: c.name, image: c.image, x: Math.round(c.x), y: Math.round(c.y), layer: "object", visibleTo: "all", sceneId: c.sceneId, autoPlace: true } };
  }
}
