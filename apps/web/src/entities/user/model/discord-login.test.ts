import { describe, expect, it } from "vitest";
import { sessionFromCallbackHash } from "./discord-login";

const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

describe("sessionFromCallbackHash", () => {
  it("토큰에서 신원과 만료를 읽는다", () => {
    const token = jwt({ sub: "u-1", exp: 2000, user_metadata: { full_name: "윤서하", custom_claims: { global_name: "서하" } } });
    expect(sessionFromCallbackHash(`#access_token=${token}&expires_in=3600`)).toEqual({ userId: "u-1", name: "서하", token, expiresAt: 2000 });
  });
  it("토큰이 없거나 깨졌으면 null", () => {
    expect(sessionFromCallbackHash("")).toBeNull();
    expect(sessionFromCallbackHash("#error=access_denied")).toBeNull();
    expect(sessionFromCallbackHash("#access_token=broken")).toBeNull();
    expect(sessionFromCallbackHash(`#access_token=${jwt({ exp: 1 })}`)).toBeNull();
  });
});
