import { describe, expect, it } from "vitest";
import { humanizeError, MAX_TOASTS, pushToast, type Toast } from "./toasts";

const t = (text: string) => ({ kind: "error" as const, text, ttl: 5000 });

describe("pushToast", () => {
  it("같은 문구는 하나만 남기고 맨 뒤로 보낸다", () => {
    let l: Toast[] = [];
    l = pushToast(l, t("a"), 1);
    l = pushToast(l, t("b"), 2);
    l = pushToast(l, t("a"), 3);
    expect(l.map((x) => [x.text, x.id])).toEqual([["b", 2], ["a", 3]]);
  });
  it("가득 차면 오래된 것부터 밀어낸다", () => {
    let l: Toast[] = [];
    for (let i = 0; i < MAX_TOASTS + 2; i++) l = pushToast(l, t(`m${i}`), i);
    expect(l).toHaveLength(MAX_TOASTS);
    expect(l[0]!.text).toBe("m2");
  });
});

describe("humanizeError", () => {
  it("한글 문장은 그대로 쓴다", () => {
    expect(humanizeError({ code: "bad_message", message: "이미 세션이 진행 중이에요." })).toBe("이미 세션이 진행 중이에요.");
  });
  it("코드만 오면 해요체 문장으로 바꾼다", () => {
    expect(humanizeError({ code: "stale", message: "stale" })).toMatch(/요\.$/);
    expect(humanizeError({ code: "rate_limited", message: "" })).toContain("너무 빨리");
    expect(humanizeError({ code: "weird", message: "ERR_X" })).toBe("문제가 생겼어요. 잠시 뒤에 다시 해 주세요.");
  });
});
