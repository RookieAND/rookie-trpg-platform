import { describe, expect, it } from "vitest";
import type { Member } from "@coc-vtt/shared";
import { checkDraft, chatTargets, nearBottom, shouldSendOnEnter, speakerField, speakerFromValue, speakerValue, whisperLabel, whisperRecipients } from "./chat-view";

const members: Member[] = [
  { userId: "kp", name: "하늘", role: "kp", online: true },
  { userId: "a", name: "서하", role: "pl", online: true },
  { userId: "b", name: "도윤", role: "pl", online: false },
  { userId: "s", name: "구경", role: "spectator", online: true },
];

describe("whisperRecipients", () => {
  it("GM은 PL에게, PL은 GM에게, PL끼리는 허용했을 때만", () => {
    expect(whisperRecipients(members, "kp", "kp", false).map((m) => m.userId)).toEqual(["a", "b"]);
    expect(whisperRecipients(members, "a", "pl", false).map((m) => m.userId)).toEqual(["kp"]);
    expect(whisperRecipients(members, "a", "pl", true).map((m) => m.userId)).toEqual(["kp", "b"]);
    expect(whisperRecipients(members, "s", "spectator", true)).toEqual([]);
  });
});

describe("chatTargets", () => {
  it("GM은 PL의 캐릭터 이름으로도 부를 수 있고 PL은 GM 별칭만 쓴다", () => {
    const chars = [{ name: "윤서하", ownerId: "a" }];
    expect(chatTargets(members, "kp", "kp", chars).find((t) => t.userId === "a")!.names).toEqual(["서하", "윤서하"]);
    expect(chatTargets(members, "b", "pl", chars).find((t) => t.userId === "a")!.names).toEqual(["서하"]);
    expect(chatTargets(members, "b", "pl", chars).find((t) => t.userId === "kp")!.names).toEqual(["하늘", "GM"]);
    expect(chatTargets(members, "b", "pl", chars).some((t) => t.userId === "s")).toBe(false);
  });
});

describe("checkDraft", () => {
  const base = { targets: chatTargets(members, "b", "pl", []), whisperTo: "", canRoll: true, rollWhy: null, canWhisper: true };
  it("말은 보내고, 빈 글은 오류", () => {
    expect(checkDraft("안녕", base)).toEqual({ kind: "send" });
    expect(checkDraft("   ", base)).toMatchObject({ kind: "error" });
  });
  it("도움말·모르는 명령", () => {
    expect(checkDraft("/?", base)).toEqual({ kind: "help" });
    expect(checkDraft("/zz", base)).toMatchObject({ kind: "error" });
  });
  it("굴림은 굴릴 수 있을 때만, 이유를 알려 준다", () => {
    expect(checkDraft("/r 1d100", base)).toEqual({ kind: "send" });
    expect(checkDraft("/r 1d100", { ...base, canRoll: false, rollWhy: "세션이 시작되면 굴릴 수 있어요." })).toEqual({ kind: "error", message: "세션이 시작되면 굴릴 수 있어요." });
  });
  it("받는 사람을 골랐으면 /로 시작해도 그대로 보낸다", () => {
    expect(checkDraft("/zz", { ...base, whisperTo: "kp" })).toEqual({ kind: "send" });
  });
  it("귓속말 이름 풀기", () => {
    expect(checkDraft("/w GM 안녕", base)).toEqual({ kind: "send" });
    expect(checkDraft("/w 없는사람 안녕", base)).toMatchObject({ kind: "error" });
  });
});

describe("speaker", () => {
  it("값 왕복과 서버 필드", () => {
    for (const s of [{ kind: "self" }, { kind: "gm" }, { kind: "character", id: "x1" }] as const) expect(speakerFromValue(speakerValue(s))).toEqual(s);
    expect(speakerField({ kind: "self" })).toBeUndefined();
    expect(speakerField({ kind: "gm" })).toEqual({ gm: true });
    expect(speakerField({ kind: "character", id: "x1" })).toEqual({ characterId: "x1" });
  });
});

describe("shouldSendOnEnter (한글 조합 중에는 보내지 않는다)", () => {
  it("Enter만 보낸다", () => {
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: false }, false)).toBe(true);
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: true }, false)).toBe(false);
    expect(shouldSendOnEnter({ key: "a", shiftKey: false }, false)).toBe(false);
  });
  it("조합 중이면 보내지 않는다(isComposing, keyCode 229, 조합 상태 기억 모두)", () => {
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: false, isComposing: true }, false)).toBe(false);
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: false, keyCode: 229 }, false)).toBe(false);
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: false }, true)).toBe(false);
  });
});

describe("whisperLabel / nearBottom", () => {
  it("방향 표시", () => {
    const m = { name: "서하", userId: "a", to: { userId: "kp", name: "하늘" } };
    expect(whisperLabel(m, "a")).toBe("나 → 하늘");
    expect(whisperLabel(m, "kp")).toBe("서하 → 나");
    expect(whisperLabel({ name: "서하", userId: "a" }, "a")).toBe("");
  });
  it("바닥 근처 판단", () => {
    expect(nearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 350 })).toBe(true);
    expect(nearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 350 })).toBe(false);
  });
});
