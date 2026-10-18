/**
 * 시나리오 파일의 사전 검증(순수 로직). 룸을 만들기 전에 전부 확인해서 어중간한 룸이 남지 않게 한다.
 * 파일 시스템은 `readAudio`로 주입받는다(테스트에서 가짜로 바꿀 수 있게).
 */
import { isAbsolute, normalize, sep } from "node:path";
import { AUDIO_KINDS, MAX_AUDIO_TRACKS, MAX_BEATS, MAX_BEAT_HANDOUTS, MAX_BRANCHES, MAX_MADNESS_ENTRIES } from "@coc-vtt/shared";
import { MAX_AUDIO_BYTES, sniffAudio } from "../src/image/domain/image-storage";

export const MADNESS_ENTRY_MAX_LENGTH = 120;
export const AUDIO_LABEL_MAX_LENGTH = 40;

export interface ScenarioAudio {
  key: string;
  label: string;
  kind: "bgm" | "se";
  /** 시나리오 JSON 기준 상대 경로 */
  file: string;
}

export interface ScenarioFile {
  format: string;
  version: number;
  roomName: string;
  scenes: Array<{ key: string; name: string; start?: boolean; bgm?: string }>;
  tokens: Array<{ scene: string; kind: "token" | "prop"; name: string; x: number; y: number; layer: "background" | "object" | "gm"; visibleTo: "all" | "gm" }>;
  characters: Array<{
    name: string;
    age: number;
    occupation: string;
    characteristics: Record<"STR" | "CON" | "SIZ" | "DEX" | "APP" | "INT" | "POW" | "EDU", number>;
    hp?: number;
    san?: number;
    skills: Array<{ name: string; value: number }>;
    notes?: string;
    backstory?: string;
  }>;
  handouts: Array<{ key: string; title: string; body: string; visibleTo: "all" | "gm" }>;
  beats: Array<{ key: string; name: string; kind: "start" | "progress" | "ending"; scene?: string; handouts: string[]; memo: string; sanReward?: string; bgm?: string }>;
  branches: Array<{ from: string; to: string; label: string }>;
  madnessTable?: string[];
  audio?: ScenarioAudio[];
}

/** 오디오 파일을 읽어 돌려준다. 없으면 null. */
export type ReadAudio = (relativePath: string) => Buffer | null;

const KEY = /^[A-Za-z0-9_-]{1,40}$/;

/** 문제를 전부 모아 돌려준다. 비어 있으면 통과. */
export function validateScenario(sc: ScenarioFile, readAudio: ReadAudio): string[] {
  const errors: string[] = [];
  const add = (m: string) => errors.push(m);

  // 광기표
  if (sc.madnessTable !== undefined) {
    if (!Array.isArray(sc.madnessTable) || sc.madnessTable.some((e) => typeof e !== "string")) add("madnessTable은 문자열 목록이어야 해요.");
    else {
      if (sc.madnessTable.length > MAX_MADNESS_ENTRIES) add(`madnessTable은 ${MAX_MADNESS_ENTRIES}개까지예요(지금 ${sc.madnessTable.length}개).`);
      sc.madnessTable.forEach((e, i) => {
        const t = e.trim();
        if (t.length === 0) add(`madnessTable[${i}]이 비어 있어요.`);
        else if (t.length > MADNESS_ENTRY_MAX_LENGTH) add(`madnessTable[${i}]이 ${MADNESS_ENTRY_MAX_LENGTH}자를 넘어요(지금 ${t.length}자).`);
      });
    }
  }

  // 음향
  const tracks = new Map<string, ScenarioAudio>();
  if (sc.audio !== undefined) {
    if (!Array.isArray(sc.audio)) add("audio는 목록이어야 해요.");
    else {
      if (sc.audio.length > MAX_AUDIO_TRACKS) add(`audio는 ${MAX_AUDIO_TRACKS}개까지예요(지금 ${sc.audio.length}개).`);
      sc.audio.forEach((a, i) => {
        const at = `audio[${i}]`;
        if (typeof a.key !== "string" || !KEY.test(a.key)) return add(`${at}.key는 영문·숫자·-·_ 40자 이내여야 해요.`);
        if (tracks.has(a.key)) return add(`${at}.key "${a.key}"가 겹쳐요.`);
        tracks.set(a.key, a);
        const label = typeof a.label === "string" ? a.label.trim() : "";
        if (label.length < 1 || label.length > AUDIO_LABEL_MAX_LENGTH) add(`${at}(${a.key}).label은 1~${AUDIO_LABEL_MAX_LENGTH}자여야 해요.`);
        if (!(AUDIO_KINDS as readonly string[]).includes(a.kind)) add(`${at}(${a.key}).kind는 "bgm" 또는 "se"여야 해요.`);
        if (typeof a.file !== "string" || a.file.trim() === "") return add(`${at}(${a.key}).file이 비어 있어요.`);
        const n = normalize(a.file);
        if (isAbsolute(a.file) || n === ".." || n.startsWith(`..${sep}`)) return add(`${at}(${a.key}).file은 시나리오 파일 기준 상대 경로여야 해요: ${a.file}`);
        const bytes = readAudio(a.file);
        if (!bytes) return add(`${at}(${a.key}) 파일이 없어요: ${a.file}`);
        if (bytes.length === 0) return add(`${at}(${a.key}) 파일이 비어 있어요: ${a.file}`);
        if (bytes.length > MAX_AUDIO_BYTES) return add(`${at}(${a.key}) 파일이 너무 커요(최대 10MB, 지금 ${(bytes.length / 1024 / 1024).toFixed(1)}MB): ${a.file}`);
        if (!sniffAudio(bytes)) add(`${at}(${a.key}) 형식을 알 수 없어요(MP3·OGG·WAV·M4A만 돼요): ${a.file}`);
      });
    }
  }

  // 참조: 장면·비트의 bgm
  const checkBgm = (where: string, key: string | undefined) => {
    if (key === undefined) return;
    const t = tracks.get(key);
    if (!t) add(`${where}.bgm "${key}"에 해당하는 audio가 없어요.`);
    else if (t.kind !== "bgm") add(`${where}.bgm "${key}"는 효과음(se)이라 배경음으로 쓸 수 없어요.`);
  };
  sc.scenes.forEach((s, i) => checkBgm(`scenes[${i}](${s.key})`, s.bgm));
  sc.beats.forEach((b, i) => checkBgm(`beats[${i}](${b.key})`, b.bgm));

  // 기존 항목의 참조·상한(룸을 만든 뒤에야 터지지 않게)
  const sceneKeys = new Set(sc.scenes.map((s) => s.key));
  const handoutKeys = new Set(sc.handouts.map((h) => h.key));
  const beatKeys = new Set(sc.beats.map((b) => b.key));
  if (sc.scenes.length === 0) add("scenes가 비어 있어요.");
  sc.tokens.forEach((t, i) => {
    if (!sceneKeys.has(t.scene)) add(`tokens[${i}](${t.name}).scene "${t.scene}"이 scenes에 없어요.`);
  });
  if (sc.beats.length > MAX_BEATS) add(`beats는 ${MAX_BEATS}개까지예요(지금 ${sc.beats.length}개).`);
  if (sc.branches.length > MAX_BRANCHES) add(`branches는 ${MAX_BRANCHES}개까지예요(지금 ${sc.branches.length}개).`);
  sc.beats.forEach((b, i) => {
    if (b.scene && !sceneKeys.has(b.scene)) add(`beats[${i}](${b.key}).scene "${b.scene}"이 scenes에 없어요.`);
    if (b.handouts.length > MAX_BEAT_HANDOUTS) add(`beats[${i}](${b.key}).handouts는 ${MAX_BEAT_HANDOUTS}개까지예요.`);
    for (const h of b.handouts) if (!handoutKeys.has(h)) add(`beats[${i}](${b.key}).handouts "${h}"가 handouts에 없어요.`);
  });
  sc.branches.forEach((br, i) => {
    if (!beatKeys.has(br.from)) add(`branches[${i}].from "${br.from}"이 beats에 없어요.`);
    if (!beatKeys.has(br.to)) add(`branches[${i}].to "${br.to}"이 beats에 없어요.`);
  });

  return errors;
}

/**
 * 가져오기 파일에서 제목이 `[KP]`(또는 `[GM]`)로 시작하면 GM 전용 노트다.
 * 표시용 제목에서는 이 머리말을 떼어 사용자 화면에 보이지 않게 한다.
 */
export function splitNoteTitle(title: string): { title: string; kpOnly: boolean } {
  const m = /^\[(?:KP|GM)\]\s*/i.exec(title);
  if (!m) return { title, kpOnly: false };
  return { title: title.slice(m[0].length).trim() || title, kpOnly: true };
}
