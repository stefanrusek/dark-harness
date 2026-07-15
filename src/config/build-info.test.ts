// Round 8 (ADR 0005 amendment): unit tests for the pure raw->BuildInfo mapping. BUILD_INFO
// itself (the process-wide constant read from process.env.DH_BUILD_*) isn't separately
// tested here — it's a one-line application of computeBuildInfo(), and re-testing it would
// mean asserting against whatever DH_BUILD_* happens to be set (or not) in this test
// process's own environment, which isn't meaningfully different from testing
// computeBuildInfo() itself with injected values, per this function's own doc comment.

import { describe, expect, test } from "bun:test";
import pkg from "../../package.json" with { type: "json" };
import { computeBuildInfo } from "./build-info.ts";

describe("computeBuildInfo", () => {
  test("stamped clean: real sha, dirty=false, no release tag", () => {
    const info = computeBuildInfo({ gitSha: "abc123", dirty: "false", releaseTag: undefined });
    expect(info).toEqual({
      version: pkg.version,
      gitSha: "abc123",
      dirty: false,
      releaseTag: null,
    });
  });

  test("stamped dirty: real sha, dirty=true", () => {
    const info = computeBuildInfo({ gitSha: "abc123", dirty: "true", releaseTag: undefined });
    expect(info).toEqual({ version: pkg.version, gitSha: "abc123", dirty: true, releaseTag: null });
  });

  test("unstamped: no sha at all (running from source, or a raw bun build --compile)", () => {
    const info = computeBuildInfo({ gitSha: undefined, dirty: undefined, releaseTag: undefined });
    expect(info).toEqual({ version: pkg.version, gitSha: null, dirty: false, releaseTag: null });
  });

  test("unstamped via empty-string stamps (what scripts/build.ts embeds when git is unavailable)", () => {
    const info = computeBuildInfo({ gitSha: "", dirty: "false", releaseTag: "" });
    expect(info).toEqual({ version: pkg.version, gitSha: null, dirty: false, releaseTag: null });
  });

  test("dirty=true is ignored when there's no sha to anchor it to", () => {
    const info = computeBuildInfo({ gitSha: "", dirty: "true", releaseTag: undefined });
    expect(info.dirty).toBe(false);
  });

  test("release-tagged: sha, clean, with a release tag", () => {
    const info = computeBuildInfo({ gitSha: "def456", dirty: "false", releaseTag: "v0.1.0" });
    expect(info).toEqual({
      version: pkg.version,
      gitSha: "def456",
      dirty: false,
      releaseTag: "v0.1.0",
    });
  });

  test("release-tagged and dirty", () => {
    const info = computeBuildInfo({ gitSha: "def456", dirty: "true", releaseTag: "v0.1.0" });
    expect(info).toEqual({
      version: pkg.version,
      gitSha: "def456",
      dirty: true,
      releaseTag: "v0.1.0",
    });
  });
});
