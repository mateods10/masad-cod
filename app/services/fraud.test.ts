import { describe, expect, it } from "vitest";
import { hashClientIp } from "./fraud.server";

describe("fraud IP protection", () => {
  it("uses the originating public IP and stores only a stable hash", () => {
    process.env.FRAUD_IP_HASH_KEY = "test-key";
    const headers = new Headers({ "x-forwarded-for": "181.39.12.4, 10.0.0.5" });
    const hash = hashClientIp(headers, "luminos-test.myshopify.com");
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).not.toContain("181.39.12.4");
    expect(hash).toBe(hashClientIp(headers, "luminos-test.myshopify.com"));
  });

  it("does not hash internal proxy addresses", () => {
    process.env.FRAUD_IP_HASH_KEY = "test-key";
    expect(hashClientIp(new Headers({ "x-forwarded-for": "10.0.0.10" }), "luminos-test.myshopify.com")).toBeNull();
  });
});
