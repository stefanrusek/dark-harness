import { describe, expect, test } from "bun:test";
import { constantTimeEqual, extractBearerToken, isAuthorized } from "./auth.ts";

describe("constantTimeEqual", () => {
  test("true for identical strings", () => {
    expect(constantTimeEqual("secret", "secret")).toBe(true);
  });

  test("false for different strings of the same length", () => {
    expect(constantTimeEqual("secretA", "secretB")).toBe(false);
  });

  test("false for different-length strings (no throw, no length side-channel)", () => {
    expect(constantTimeEqual("short", "a-lot-longer-string")).toBe(false);
  });

  test("false against an empty string", () => {
    expect(constantTimeEqual("secret", "")).toBe(false);
  });
});

describe("extractBearerToken", () => {
  test("extracts the token from a well-formed header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });

  test("null when the header is absent", () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  test("null when the header doesn't start with 'Bearer '", () => {
    expect(extractBearerToken("Basic abc123")).toBeNull();
  });

  test("null when the token portion is empty", () => {
    expect(extractBearerToken("Bearer ")).toBeNull();
  });
});

describe("isAuthorized", () => {
  test("always true when no token is configured (default posture, ADR 0004)", () => {
    expect(isAuthorized(null, undefined)).toBe(true);
    expect(isAuthorized("garbage", undefined)).toBe(true);
  });

  test("true when the header carries the exact configured token", () => {
    expect(isAuthorized("Bearer s3cret", "s3cret")).toBe(true);
  });

  test("false when the header is missing", () => {
    expect(isAuthorized(null, "s3cret")).toBe(false);
  });

  test("false when the header carries the wrong token", () => {
    expect(isAuthorized("Bearer wrong", "s3cret")).toBe(false);
  });

  test("false when the header isn't a Bearer header at all", () => {
    expect(isAuthorized("Basic s3cret", "s3cret")).toBe(false);
  });
});
