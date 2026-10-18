/**
 * CLI 전용: 시나리오 파일 속 "내 컴퓨터의 파일 경로"(이미지 ref, 오디오 file)를 읽어 데이터 주소로 바꾼다.
 * 서버는 파일 경로를 쓰지 않으므로, 여기서 존재·크기·형식을 먼저 확인하고 문제는 전부 모아 돌려준다.
 * 파일 시스템은 `read`로 주입받는다(테스트에서 가짜로 바꿀 수 있게).
 */
import { isAbsolute, normalize, sep } from "node:path";
import { classifyRef, type ScenarioDoc } from "@coc-vtt/shared";
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, sniffAudio, sniffImage } from "../src/image/domain/image-storage";

export type ReadLocal = (relativePath: string) => Buffer | null;

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

export function inlineLocalFiles(input: ScenarioDoc, read: ReadLocal): { doc: ScenarioDoc; errors: string[] } {
  const doc = JSON.parse(JSON.stringify(input)) as ScenarioDoc;
  const errors: string[] = [];
  const cache = new Map<string, string | null>();

  const load = (where: string, path: string, kind: "image" | "audio"): string | undefined => {
    const memo = `${kind}:${path}`;
    if (cache.has(memo)) return cache.get(memo) ?? undefined;
    const fail = (m: string) => (errors.push(`${where}: ${m}: ${path}`), cache.set(memo, null), undefined);
    const n = normalize(path);
    if (isAbsolute(path) || n === ".." || n.startsWith(`..${sep}`)) return fail("시나리오 파일 기준 상대 경로여야 해요");
    const bytes = read(path);
    if (!bytes) return fail("파일이 없어요");
    if (bytes.length === 0) return fail("파일이 비어 있어요");
    const limit = kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
    if (bytes.length > limit) return fail(`파일이 너무 커요(최대 ${mb(limit)}MB, 지금 ${mb(bytes.length)}MB)`);
    const mime = kind === "image" ? sniffImage(bytes) : sniffAudio(bytes);
    if (!mime) return fail(kind === "image" ? "형식을 알 수 없어요(PNG·JPG·GIF·WEBP만 돼요)" : "형식을 알 수 없어요(MP3·OGG·WAV·M4A만 돼요)");
    const url = `data:${mime};base64,${bytes.toString("base64")}`;
    cache.set(memo, url);
    return url;
  };

  const image = (where: string, ref: string | undefined): string | undefined => {
    if (!ref) return ref;
    const c = classifyRef(ref);
    return c.kind === "file" ? load(where, c.path, "image") : ref;
  };

  doc.scenes.forEach((s, i) => (s.background = image(`scenes[${i}](${s.key}).background`, s.background)));
  doc.tokens.forEach((t, i) => (t.image = image(`tokens[${i}](${t.name}).image`, t.image)));
  doc.handouts.forEach((h, i) => (h.image = image(`handouts[${i}](${h.key}).image`, h.image)));
  (doc.audio ?? []).forEach((a, i) => {
    if (!a.file) return;
    a.data = load(`audio[${i}](${a.key}).file`, a.file, "audio");
    delete a.file;
  });
  if (doc.media) {
    for (const [id, ref] of Object.entries(doc.media)) doc.media[id] = image(`media.${id}`, ref) ?? ref;
  }
  return { doc, errors };
}
