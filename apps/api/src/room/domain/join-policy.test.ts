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

describe("decideJoin: 관전 초대", () => {
  const withSpec = { ...meta, invite: { code: "abc", expiresAt: null, maxMembers: 2 }, spectatorInvite: { code: "see", expiresAt: 2000, maxMembers: 2 } };
  it("관전 코드로 오면 요청한 역할과 상관없이 관전자다", () => {
    expect(decideJoin(withSpec, [], "n", "pl", "see", 0)).toEqual({ ok: true, role: "spectator" });
    expect(decideJoin(withSpec, [], "n", "spectator", "see", 0)).toEqual({ ok: true, role: "spectator" });
  });
  it("관전 코드로는 GM도 PL도 될 수 없다", () => {
    expect(decideJoin(withSpec, [], "n", "kp", "see", 0)).toMatchObject({ reason: "not_owner" });
    expect(decideJoin(withSpec, [], "n", "pl", "see", 0)).not.toEqual({ ok: true, role: "pl" });
  });
  it("관전 링크가 없으면 그 코드는 통하지 않는다", () => {
    expect(decideJoin(meta, [], "n", "pl", "see", 0)).toMatchObject({ reason: "no_access" });
  });
  it("만료와 정원은 관전 링크의 것을 따르고, 관전자는 PL 정원을 쓰지 않는다", () => {
    expect(decideJoin(withSpec, [], "n", "pl", "see", 2001)).toMatchObject({ reason: "invite_expired" });
    const specs = [{ userId: "s1", role: "spectator" as const }, { userId: "s2", role: "spectator" as const }];
    expect(decideJoin(withSpec, specs, "n", "pl", "see", 0)).toMatchObject({ reason: "room_full" });
    // PL 한 명 자리(주인 포함 2명)는 관전자 때문에 줄지 않는다
    expect(decideJoin(withSpec, specs, "n", "pl", "abc", 0)).toEqual({ ok: true, role: "pl" });
  });
  it("PL 코드로 관전자를 요청하면 관전자로 들어오고 이미 멤버는 원래 역할이다", () => {
    expect(decideJoin(withSpec, [], "n", "spectator", "abc", 0)).toEqual({ ok: true, role: "spectator" });
    expect(decideJoin(withSpec, [{ userId: "s1", role: "spectator" }], "s1", "pl", null, 0)).toEqual({ ok: true, role: "spectator" });
  });
});
