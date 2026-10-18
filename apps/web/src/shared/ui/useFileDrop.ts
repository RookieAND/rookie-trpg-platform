"use client";
import { useRef, useState, type DragEvent } from "react";

/** 이 끌기에 파일이 들어 있는가(끄는 동안에는 파일 이름·형식을 알 수 없고 종류만 보인다). */
export const dragHasFiles = (e: Pick<DragEvent, "dataTransfer">) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/** 파일을 끌어다 놓을 수 있는 영역에 붙이는 속성과, 지금 파일이 위에 있는지 여부. */
export function useFileDrop(onFiles: (files: FileList) => void, disabled?: boolean) {
  const [over, setOver] = useState(false);
  const depth = useRef(0); // 자식 요소를 넘나들 때 dragleave가 잘못 켜고 끄지 않게 센다
  const props = {
    onDragEnter: (e: DragEvent) => {
      if (disabled || !dragHasFiles(e)) return;
      depth.current += 1;
      setOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (disabled || !dragHasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault(); // 브라우저가 그림 파일을 열어 버리지 않게
      depth.current = 0;
      setOver(false);
      if (!disabled && e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
    },
  };
  return { over, props };
}
