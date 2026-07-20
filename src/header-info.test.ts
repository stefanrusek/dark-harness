import { describe, expect, test } from "bun:test";
import type { DhConfig } from "./contracts/index.ts";
import {
  buildConfigStatusSummary,
  buildHeaderInfo,
  formatConfigStatusLine,
  formatEmptyStateLines,
  formatHeaderLines,
  formatVersionString,
} from "./header-info.ts";
import { HEADER_A2_WORDMARK_PLAIN } from "./prompt/banner.constant.ts";

function baseConfig(overrides: Partial<DhConfig> = {}): DhConfig {
  return {
    options: { defaultModel: "sonnet" },
    models: [
      { name: "sonnet", provider: "anthropic", model: "claude-sonnet-5" },
      { name: "haiku", provider: "anthropic", model: "claude-haiku-4-5" },
    ],
    provider: [{ name: "anthropic", type: "anthropic" }],
    ...overrides,
  };
}

describe("formatVersionString", () => {
  test("unstamped build", () => {
    expect(
      formatVersionString({ version: "0.1.0", gitSha: null, dirty: false, releaseTag: null }),
    ).toBe("dh 0.1.0 (unstamped)");
  });

  test("stamped clean build", () => {
    expect(
      formatVersionString({ version: "0.1.0", gitSha: "abc123", dirty: false, releaseTag: null }),
    ).toBe("dh 0.1.0 (abc123)");
  });

  test("stamped dirty build", () => {
    expect(
      formatVersionString({ version: "0.1.0", gitSha: "abc123", dirty: true, releaseTag: null }),
    ).toBe("dh 0.1.0 (abc123 dirty)");
  });

  test("stamped release build", () => {
    expect(
      formatVersionString({
        version: "0.1.0",
        gitSha: "abc123",
        dirty: false,
        releaseTag: "v0.1.0",
      }),
    ).toBe("dh 0.1.0 (abc123, v0.1.0)");
  });

  test("stamped dirty release build", () => {
    expect(
      formatVersionString({
        version: "0.1.0",
        gitSha: "abc123",
        dirty: true,
        releaseTag: "v0.1.0",
      }),
    ).toBe("dh 0.1.0 (abc123 dirty, v0.1.0)");
  });
});

describe("buildConfigStatusSummary", () => {
  test("null config reports not-exists with zero models", () => {
    expect(buildConfigStatusSummary(null, "dh.json")).toEqual({
      exists: false,
      path: "dh.json",
      modelCount: 0,
      hasToken: false,
      hasTls: false,
    });
  });

  test("a plain config (no security block) reports model count with defaults", () => {
    expect(buildConfigStatusSummary(baseConfig(), "dh.json")).toEqual({
      exists: true,
      path: "dh.json",
      modelCount: 2,
      hasToken: false,
      hasTls: false,
    });
  });

  test("security.hostname/token/tls surface without leaking the token value", () => {
    const summary = buildConfigStatusSummary(
      baseConfig({
        security: { hostname: "0.0.0.0", token: "super-secret", tls: { cert: "c", key: "k" } },
      }),
      "custom.json",
    );
    expect(summary).toEqual({
      exists: true,
      path: "custom.json",
      modelCount: 2,
      hostname: "0.0.0.0",
      hasToken: true,
      hasTls: true,
    });
    expect(JSON.stringify(summary)).not.toContain("super-secret");
  });
});

describe("formatConfigStatusLine", () => {
  test("missing config", () => {
    expect(
      formatConfigStatusLine({
        exists: false,
        path: "dh.json",
        modelCount: 0,
        hasToken: false,
        hasTls: false,
      }),
    ).toBe("config: not found (dh.json)");
  });

  test("existing config, no security block: all interfaces, no token", () => {
    expect(
      formatConfigStatusLine({
        exists: true,
        path: "dh.json",
        modelCount: 3,
        hasToken: false,
        hasTls: false,
      }),
    ).toBe("config: dh.json — 3 models, bind all interfaces, no token");
  });

  test("singular model count", () => {
    expect(
      formatConfigStatusLine({
        exists: true,
        path: "dh.json",
        modelCount: 1,
        hasToken: false,
        hasTls: false,
      }),
    ).toBe("config: dh.json — 1 model, bind all interfaces, no token");
  });

  test("bound hostname, token required, tls on", () => {
    expect(
      formatConfigStatusLine({
        exists: true,
        path: "dh.json",
        modelCount: 2,
        hostname: "127.0.0.1",
        hasToken: true,
        hasTls: true,
      }),
    ).toBe("config: dh.json — 2 models, bind 127.0.0.1, token required, tls on");
  });
});

describe("buildHeaderInfo / formatHeaderLines", () => {
  const build = { version: "0.1.0", gitSha: "abc123", dirty: false, releaseTag: null };

  test("wires name/logo/build/config together", () => {
    const info = buildHeaderInfo(baseConfig(), "dh.json", build);
    expect(info.name).toBe("dh");
    expect(info.logoCompact).toBe(HEADER_A2_WORDMARK_PLAIN);
    expect(info.build).toEqual(build);
    expect(info.config.modelCount).toBe(2);
  });

  test("formatHeaderLines includes the full logo by default, version, and config status", () => {
    const info = buildHeaderInfo(baseConfig(), "dh.json", build);
    const lines = formatHeaderLines(info);
    expect(lines[0]).toBe(info.logoFull.split("\n")[0]);
    expect(lines).toContain("dh 0.1.0 (abc123)");
    expect(lines).toContain("config: dh.json — 2 models, bind all interfaces, no token");
  });

  test("formatHeaderLines({ compact: true }) omits the logo entirely", () => {
    const info = buildHeaderInfo(baseConfig(), "dh.json", build);
    const lines = formatHeaderLines(info, { compact: true });
    expect(lines).toEqual([
      "dh 0.1.0 (abc123)",
      "config: dh.json — 2 models, bind all interfaces, no token",
    ]);
  });
});

describe("formatEmptyStateLines", () => {
  const build = { version: "0.1.0", gitSha: "abc123", dirty: false, releaseTag: null };

  test("DH-0124: compact logo + version only, no config-status line", () => {
    const info = buildHeaderInfo(baseConfig(), "dh.json", build);
    expect(formatEmptyStateLines(info)).toEqual([HEADER_A2_WORDMARK_PLAIN, "dh 0.1.0 (abc123)"]);
  });

  test("DH-0124: unaffected by config being absent (no dh.json known, e.g. --connect)", () => {
    const info = buildHeaderInfo(null, "dh.json", build);
    expect(formatEmptyStateLines(info)).toEqual([HEADER_A2_WORDMARK_PLAIN, "dh 0.1.0 (abc123)"]);
  });
});
