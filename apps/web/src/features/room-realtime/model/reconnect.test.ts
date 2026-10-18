import { describe, expect, it } from "vitest";
import { backoffMs, nextAfterClose } from "./reconnect";

const base = { stopped: false, hasToken: true, canRefresh: true, alreadyRefreshed: false };

describe("nextAfterClose", () => {
  it("토큰 로그인에서 4401이면 한 번 갱신한다", () => {
    expect(nextAfterClose({ ...base, code: 4401 })).toBe("refresh");
  });
  it("이미 갱신했는데도 4401이면 멈춘다(다시 로그인)", () => {
    expect(nextAfterClose({ ...base, code: 4401, alreadyRefreshed: true })).toBe("stop");
  });
  it("개발용 로그인(토큰 없음)이나 갱신 수단이 없으면 4401에서 멈춘다", () => {
    expect(nextAfterClose({ ...base, code: 4401, hasToken: false })).toBe("stop");
    expect(nextAfterClose({ ...base, code: 4401, canRefresh: false })).toBe("stop");
  });
  it("접근 거절·없는 룸·정원 초과는 멈추고, 일시적 끊김은 다시 붙는다", () => {
    for (const code of [4403, 4404, 4409, 4410]) expect(nextAfterClose({ ...base, code })).toBe("stop");
    for (const code of [1006, 1001, 4408]) expect(nextAfterClose({ ...base, code })).toBe("retry");
  });
  it("우리가 닫은 연결은 다시 붙지 않는다", () => {
    expect(nextAfterClose({ ...base, code: 1006, stopped: true })).toBe("stop");
  });
});

describe("backoffMs", () => {
  it("두 배씩 늘고 10초에서 멈춘다", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000]);
  });
});
