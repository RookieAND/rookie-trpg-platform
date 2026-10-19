/** 메뉴 안의 항목이 대화상자를 열었다면, 닫은 뒤 초점이 돌아갈 곳은 항목(사라짐)이 아니라 메뉴를 연 버튼이다. */
export function menuTriggerOf(el: Element | null): HTMLElement | null {
  const menu = el?.closest(".menu");
  return menu?.querySelector<HTMLElement>(":scope > [aria-haspopup=\"menu\"]") ?? null;
}

/** 대화상자·메뉴를 연 곳(opener) 가운데 초점을 돌려줄 대상. 메뉴 안이면 메뉴 버튼이다. */
export function focusReturnTarget(opener: Element | null): HTMLElement | null {
  const t = menuTriggerOf(opener) ?? opener;
  return t instanceof HTMLElement ? t : null;
}

/**
 * 다음 화면 갱신 뒤에 target으로 초점을 돌려준다. onlyIfLost면 초점이 이미 다른 곳(클릭한 요소)에 있으면 그대로 둔다.
 * 닫히면서 초점이 body로 떨어지는 대화상자·메뉴·팝오버가 같이 쓴다.
 */
export function restoreFocus(target: Element | null | undefined, onlyIfLost = false) {
  if (!(target instanceof HTMLElement)) return;
  requestAnimationFrame(() => {
    if (!target.isConnected) return;
    const a = document.activeElement;
    if (onlyIfLost && a && a !== document.body && a.isConnected) return;
    target.focus();
  });
}
