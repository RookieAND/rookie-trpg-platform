/**
 * 받침에 따라 달라지는 조사를 붙인다. `josa("GM", "이/가")`는 "GM이", `josa("도윤", "을/를")`은 "도윤을".
 * 쓸 수 있는 짝은 "을/를", "은/는", "이/가", "과/와", "으로/로", "이에요/예요", "이라/라"이고,
 * 앞쪽이 받침이 있을 때, 뒤쪽이 없을 때다. "으로/로"는 ㄹ받침도 받침 없는 것처럼 "로"를 쓴다.
 * 한글 말고 숫자와 알파벳도 읽는 소리로 받침을 따진다(32 → 삼십이, GM → 지엠, HP → 에이치피).
 */
export type JosaPair = "을/를" | "은/는" | "이/가" | "과/와" | "으로/로" | "이에요/예요" | "이라/라";

// 알파벳을 하나씩 읽을 때 받침이 있는 글자: 엘, 엠, 엔, 알
const LETTER_BATCHIM = new Set(["L", "M", "N", "R"]);
// 숫자 마지막 자리를 읽을 때 받침이 있는 것: 영, 일, 삼, 육, 칠, 팔
const DIGIT_BATCHIM = new Set(["0", "1", "3", "6", "7", "8"]);
// 그 중 ㄹ받침: 일, 칠, 팔
const DIGIT_RIEUL = new Set(["1", "7", "8"]);

type Tail = "none" | "batchim" | "rieul";

function tailOf(word: string): Tail {
  const trimmed = word.replace(/[\s'"“”‘’「」『』()[\]{}<>.,!?~·…:;-]+$/u, "");
  const ch = [...trimmed].pop();
  if (!ch) return "none";
  const code = ch.codePointAt(0)!;
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    return jong === 0 ? "none" : jong === 8 ? "rieul" : "batchim";
  }
  if (/[0-9]/.test(ch)) {
    // 10, 100처럼 0으로 끝나는 수는 "십/백"으로 읽어 받침이 있다(영도 받침이 있다). 20은 이십 → 받침 있음.
    return DIGIT_RIEUL.has(ch) ? "rieul" : DIGIT_BATCHIM.has(ch) ? "batchim" : "none";
  }
  const up = ch.toUpperCase();
  if (/[A-Z]/.test(up)) return up === "L" || up === "R" ? "rieul" : LETTER_BATCHIM.has(up) ? "batchim" : "none";
  return "none";
}

export function josa(word: string, pair: JosaPair): string {
  const [withBatchim, without] = pair.split("/") as [string, string];
  const tail = tailOf(word);
  const useWith = pair === "으로/로" ? tail === "batchim" : tail !== "none";
  return `${word}${useWith ? withBatchim : without}`;
}
