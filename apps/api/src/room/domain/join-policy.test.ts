import { describe, expect, it } from "vitest";
import { decideJoin } from "./join-policy";

const meta = { ownerId: "kp", invite: { code: "abc", expiresAt: 1000, maxMembers: 3 } };
const members = [{ userId: "pl1", role: "pl" as const }];

describe("decideJoin", () => {
  it("주인은 늘 GM으로 들어온다(초대 불필요)", () => {
    expect(decideJoin(meta, [], "kp", "pl", null, 5000)).toEqual({ ok: true, role: "kp" });
  });
  it("주인이 아니면 GM으로 들어올 수 없다", () => {
    expect(decideJoin(meta, members, "x", "kp", "abc", 0)).toMatchObject({ ok: false, reason: "not_owner" });
  });
  it("이미 멤버인 사람은 코드 없이, 원래 역할로 들어온다", () => {
    expect(decideJoin(meta, members, "pl1", "spectator", null, 5000)).toEqual({ ok: true, role: "pl" });
  });
  it("처음 오는 사람은 맞는 코드가 있어야 한다", () => {
    expect(decideJoin(meta, members, "n", "pl", null, 0)).toMatchObject({ reason: "no_access" });
    expect(decideJoin(meta, members, "n", "pl", "zzz", 0)).toMatchObject({ reason: "no_access" });
    expect(decideJoin(meta, members, "n", "pl", "abc", 0)).toEqual({ ok: true, role: "pl" });
  });
  it("만료된 코드와 정원 초과는 거절한다", () => {
    expect(decideJoin(meta, members, "n", "pl", "abc", 1001)).toMatchObject({ reason: "invite_expired" });
    const full = [...members, { userId: "pl2", role: "pl" as const }];
    expect(decideJoin(meta, full, "n", "pl", "abc", 0)).toMatchObject({ reason: "room_full" });
  });
});
