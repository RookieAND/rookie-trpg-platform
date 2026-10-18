import { describe, expect, it } from "vitest";
import { countUnread, lastSeqOf } from "./unread";

const m = (seq: number, userId = "other") => ({ seq, userId });

describe("countUnread", () => {
  it("본 번호보다 새로 온 남의 대화만 센다", () => {
    expect(countUnread([m(1), m(2), m(3, "me"), m(4)], 1, "me")).toBe(2);
    expect(countUnread([m(1), m(2)], 2, "me")).toBe(0);
    expect(countUnread([], 0, "me")).toBe(0);
  });
  it("lastSeqOf", () => {
    expect(lastSeqOf([m(3), m(9), m(5)])).toBe(9);
    expect(lastSeqOf([])).toBe(0);
  });
});
