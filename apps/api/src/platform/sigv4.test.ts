import { describe, expect, it } from "vitest";
import { EMPTY_SHA256, payloadHash, signRequest, uriEncode } from "./sigv4";

// AWS 문서 "Signature Calculations for the Authorization Header"의 공개 예제 값
const KEY = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };

describe("SigV4", () => {
  it("AWS 문서 예제: GET Object (Range)", () => {
    const h = signRequest({
      ...KEY,
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { Range: "bytes=0-9" },
      payloadHash: EMPTY_SHA256,
      amzDate: "20130524T000000Z",
    });
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("AWS 문서 예제: PUT Object", () => {
    const body = "Welcome to Amazon S3.";
    const h = signRequest({
      ...KEY,
      method: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
      headers: { Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      payloadHash: payloadHash(body),
      amzDate: "20130524T000000Z",
    });
    expect(h.authorization).toContain("Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });

  it("AWS 문서 예제: 버킷 목록 조회(쿼리 문자열)", () => {
    const h = signRequest({
      ...KEY,
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J"),
      payloadHash: EMPTY_SHA256,
      amzDate: "20130524T000000Z",
    });
    expect(h.authorization).toContain("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });

  it("uriEncode", () => {
    expect(uriEncode("a b/c*d")).toBe("a%20b%2Fc%2Ad");
    expect(uriEncode("a b/c", true)).toBe("a%20b/c");
  });
});
