/** 가로로 넘치는 탭 줄에서 양쪽 끝이 잘려 있는지. 1px 안팎의 소수점 오차는 무시한다. */
export function tabEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): { left: boolean; right: boolean } {
  return { left: scrollLeft > 1, right: scrollLeft + clientWidth < scrollWidth - 1 };
}

/** 탭 하나가 줄 안에 온전히 보이도록 줄을 얼마나 옮길지(새 scrollLeft). 이미 다 보이면 그대로. 양쪽 여백 pad를 남긴다. */
export function scrollTarget(scrollLeft: number, clientWidth: number, tabLeft: number, tabWidth: number, pad = 28): number {
  if (tabLeft - pad < scrollLeft) return Math.max(0, tabLeft - pad);
  if (tabLeft + tabWidth + pad > scrollLeft + clientWidth) return tabLeft + tabWidth + pad - clientWidth;
  return scrollLeft;
}
