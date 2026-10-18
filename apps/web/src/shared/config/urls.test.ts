import { describe, expect, it } from "vitest";
import { deriveRealtimeUrl, normalizeBaseUrl, secureRealtimeUrl } from "./urls";

describe("주소 정리", () => {
  it("끝의 /를 뗀다", () => {
    expect(normalizeBaseUrl("https://api.example.com/")).toBe("https://api.example.com");
    expect(normalizeBaseUrl(" https://api.example.com// ")).toBe("https://api.example.com");
  });
  it("웹소켓 주소를 API 주소에서 만든다(https면 wss)", () => {
    expect(deriveRealtimeUrl("https://api.example.com")).toBe("wss://api.example.com/ws");
    expect(deriveRealtimeUrl("https://api.example.com/")).toBe("wss://api.example.com/ws");
    expect(deriveRealtimeUrl("http://localhost:8787")).toBe("ws://localhost:8787/ws");
  });
  it("명시한 주소가 우선이고, http로 적어도 ws로 바꾼다", () => {
    expect(deriveRealtimeUrl("https://a.example.com", "wss://rt.example.com/ws")).toBe("wss://rt.example.com/ws");
    expect(deriveRealtimeUrl("https://a.example.com", "https://rt.example.com/ws")).toBe("wss://rt.example.com/ws");
    expect(deriveRealtimeUrl("https://a.example.com", "  ")).toBe("wss://a.example.com/ws");
  });
  it("https 페이지에서 로컬이 아닌 ws는 wss로 올린다", () => {
    expect(secureRealtimeUrl("ws://api.example.com/ws", "https:")).toBe("wss://api.example.com/ws");
    expect(secureRealtimeUrl("ws://localhost:8787/ws", "https:")).toBe("ws://localhost:8787/ws");
    expect(secureRealtimeUrl("ws://127.0.0.1:8787/ws", "https:")).toBe("ws://127.0.0.1:8787/ws");
    expect(secureRealtimeUrl("ws://api.example.com/ws", "http:")).toBe("ws://api.example.com/ws");
    expect(secureRealtimeUrl("wss://api.example.com/ws", "https:")).toBe("wss://api.example.com/ws");
    expect(secureRealtimeUrl("ws://api.example.com/ws", undefined)).toBe("ws://api.example.com/ws");
  });
});
