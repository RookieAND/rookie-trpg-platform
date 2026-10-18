/**
 * 룸 데이터가 참조하는 이미지·오디오 id를 모은다.
 * 이미지와 오디오는 서버가 만든 32자리 16진수 id라서, 룸 데이터를 문자열로 펴서 그 모양을 찾는다
 * (장면 배경, 토큰·핸드아웃 이미지, 오디오 트랙 등 어디에 있든 빠짐없이 잡히도록).
 * 다른 모양의 id(UUID 등)는 잡히지 않는다.
 */
export function collectMediaIds(data: unknown): Set<string> {
  const ids = new Set<string>();
  for (const m of JSON.stringify(data ?? null).matchAll(/"([a-f0-9]{32})"/g)) ids.add(m[1] as string);
  return ids;
}
