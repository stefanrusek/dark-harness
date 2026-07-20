import { describe, expect, test } from "bun:test";
import { DH_ASCII_LOGO, DH_ASCII_LOGO_COMPACT } from "./banner.constant.ts";

describe("DH_ASCII_LOGO", () => {
  test("is plain ASCII (no unicode box-drawing or control bytes)", () => {
    expect(/^[\x20-\x7e\n]*$/.test(DH_ASCII_LOGO)).toBe(true);
  });

  test("has no leading/trailing blank lines", () => {
    expect(DH_ASCII_LOGO.startsWith("\n")).toBe(false);
    expect(DH_ASCII_LOGO.endsWith("\n")).toBe(false);
  });

  test("spans multiple lines", () => {
    expect(DH_ASCII_LOGO.split("\n").length).toBeGreaterThan(1);
  });
});

describe("DH_ASCII_LOGO_COMPACT", () => {
  test("is a single plain-ASCII line", () => {
    expect(DH_ASCII_LOGO_COMPACT).toBe("[ dh ]");
    expect(/^[\x20-\x7e]*$/.test(DH_ASCII_LOGO_COMPACT)).toBe(true);
  });
});
