"use client";

/** 장면이 바뀔 때 보드 위에 깔리는 효과. n이 바뀔 때마다 새로 재생된다(컷은 효과 없음). */
export function SceneTransition({ transition }: { transition: { kind: "cut" | "fade"; n: number } | null }) {
  if (!transition || transition.kind !== "fade") return null;
  return <div key={transition.n} className="scene-fade" data-testid="scene-fade" aria-hidden="true" />;
}
