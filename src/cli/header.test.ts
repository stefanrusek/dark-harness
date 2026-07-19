import { describe, expect, test } from "bun:test";
import type { ColorLevel } from "../design-tokens.ts";
import {
  chooseHeaderMode,
  type HeaderStatusFacts,
  renderHeaderA2,
  renderHeaderB,
  shortGitSha,
  shortLogDir,
  sizeGateOk,
  styleDhPrefix,
} from "./header.ts";

const FACTS_NO_TOKEN: HeaderStatusFacts = {
  version: "0.1.0",
  gitSha: "9d90dc69b6348f869d272e1fb3d9790f6db62c7c",
  configLine: "dh.json — 14 models",
  bindHost: "192.168.1.238",
  hasToken: false,
  webUiUrl: "http://192.168.1.238:64810",
  logDir: "/Users/stefanrusek/Code/dark-harness/.dh-logs/ac817fd0-cc1c-4458-9a67-f98fdce38883",
};

const FACTS_TOKEN: HeaderStatusFacts = {
  ...FACTS_NO_TOKEN,
  hasToken: true,
  webUiUrl: undefined,
  logDir: undefined,
};

const BIG_TERM = { columns: 100, rows: 40 };
const SMALL_TERM = { columns: 60, rows: 20 };

describe("chooseHeaderMode", () => {
  test("server mode -> b", () => {
    expect(chooseHeaderMode({ isServer: true, isWeb: false })).toBe("b");
  });
  test("web mode -> b", () => {
    expect(chooseHeaderMode({ isServer: false, isWeb: true })).toBe("b");
  });
  test("server+web -> b", () => {
    expect(chooseHeaderMode({ isServer: true, isWeb: true })).toBe("b");
  });
  test("plain interactive -> a2", () => {
    expect(chooseHeaderMode({ isServer: false, isWeb: false })).toBe("a2");
  });
});

describe("shortGitSha", () => {
  test("truncates to 7 chars", () => {
    expect(shortGitSha("9d90dc69b6348f869d272e1fb3d9790f6db62c7c")).toBe("9d90dc6");
  });
  test("undefined -> unstamped", () => {
    expect(shortGitSha(undefined)).toBe("unstamped");
  });
  test("null -> unstamped", () => {
    expect(shortGitSha(null)).toBe("unstamped");
  });
  test("empty string -> unstamped", () => {
    expect(shortGitSha("")).toBe("unstamped");
  });
});

describe("shortLogDir", () => {
  test("shortens a run-id directory to 8 chars + ellipsis", () => {
    expect(shortLogDir("/a/b/.dh-logs/ac817fd0-cc1c-4458-9a67-f98fdce38883")).toBe("ac817fd0…");
  });
  test("leaves a short basename untouched", () => {
    expect(shortLogDir("/a/b/short")).toBe("short");
  });
  test("handles a bare basename with no separators", () => {
    expect(shortLogDir("ac817fd0-cc1c")).toBe("ac817fd0…");
  });
});

describe("sizeGateOk", () => {
  test("passes at exactly the threshold", () => {
    expect(sizeGateOk(80, 30)).toBe(true);
  });
  test("fails below either dimension", () => {
    expect(sizeGateOk(79, 30)).toBe(false);
    expect(sizeGateOk(80, 29)).toBe(false);
  });
});

describe("styleDhPrefix", () => {
  test("level none returns the literal prefix, byte-stable", () => {
    expect(styleDhPrefix("none")).toBe("dh: ");
  });
  test("truecolor wraps 'dh:' in an SGR escape but keeps the literal text embedded", () => {
    const out = styleDhPrefix("truecolor");
    expect(out).toContain("dh:");
    expect(out.endsWith(" ")).toBe(true);
    expect(out).not.toBe("dh: ");
  });
  test("ansi256 wraps 'dh:' too", () => {
    const out = styleDhPrefix("ansi256");
    expect(out).toContain("dh:");
    expect(out).not.toBe("dh: ");
  });
});

const LEVELS: ColorLevel[] = ["none", "ansi256", "truecolor"];

describe("renderHeaderA2", () => {
  for (const level of LEVELS) {
    test(`${level}: full-size renders the gradient wordmark + tree (with web ui/logs)`, () => {
      const lines = renderHeaderA2(FACTS_NO_TOKEN, level, BIG_TERM);
      expect(lines.length).toBeGreaterThan (5);
      const joined = lines.join("\n");
      if (level === "none") {
        expect(joined).toContain("DARK HARNESS");
        expect(joined).toContain("no token");
      } else {
        expect(joined).toContain("dh 0.1.0");
        expect(joined).toContain("9d90dc6");
        expect(joined).toContain("192.168.1.238:64810");
      }
    });

    test(`${level}: token-required, no web ui / no logs (connect+TUI shape)`, () => {
      const lines = renderHeaderA2(FACTS_TOKEN, level, BIG_TERM);
      const joined = lines.join("\n");
      expect(joined).not.toContain("web ui");
      expect(joined).not.toContain("logs");
      expect(joined.includes("no token")).toBe(false);
    });
  }

  test("small terminal forces the plain fallback even with color available", () => {
    const lines = renderHeaderA2(FACTS_NO_TOKEN, "truecolor", SMALL_TERM);
    expect(lines[0]).toBe("DARK HARNESS");
  });

  test("no-columns/no-rows small terminal also falls back", () => {
    const lines = renderHeaderA2(FACTS_NO_TOKEN, "truecolor", { columns: 0, rows: 0 });
    expect(lines[0]).toBe("DARK HARNESS");
  });
});

describe("renderHeaderB", () => {
  for (const level of LEVELS) {
    test(`${level}: full facts (web ui + logs)`, () => {
      const lines = renderHeaderB(FACTS_NO_TOKEN, level);
      const joined = lines.join("\n");
      expect(joined).toContain("dh 0.1.0");
      expect(joined).toContain("9d90dc6");
      expect(joined).toContain("192.168.1.238:64810");
      expect(lines[lines.length - 1]).toContain("ready");
    });

    test(`${level}: no web ui / no logs (token required)`, () => {
      const lines = renderHeaderB(FACTS_TOKEN, level);
      const joined = lines.join("\n");
      expect(joined).not.toContain("web ui");
      expect(joined).toContain("required");
    });
  }
});
