#!/usr/bin/env bun
// Core round 8 (docs/handoffs/core.md, ADR 0005 amendment): wraps `bun build ./src/cli.ts
// --compile` so every compiled `dh` binary — local dev builds, CI/release builds, and E2E's
// own test binary — gets the same build-identity stamp baked in via `--define`
// substitution of the three `process.env.DH_BUILD_*` member expressions read by
// src/config/build-info.ts. A binary built by calling `bun build` directly (bypassing this
// script) is not an error, just unstamped — computeBuildInfo() treats missing values as
// null/false, exactly like running from source.
//
// Owning domain: scripts/ is Core-owned (CLAUDE.md §3).
//
// Usage:
//   bun scripts/build.ts [--target <t>] [--outfile <path>] [--release-tag <tag>]
//
// --target <t>          Passed through to `bun build --target <t>` (cross-compile). Omitted
//                        entirely when not given, matching bun's own "build for this host"
//                        default.
// --outfile <path>       Output path (default: dist/dh).
// --release-tag <tag>    Stamped as BuildInfo.releaseTag. Must match /^v/ (e.g. "v0.1.0") —
//                        exits 2 otherwise. Omitted entirely for a non-release (dev/CI) build,
//                        which stamps releaseTag: null.

function parseArgs(argv: string[]): {
  target: string | undefined;
  outfile: string;
  releaseTag: string | undefined;
} {
  let target: string | undefined;
  let outfile = "dist/dh";
  let releaseTag: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      i += 1;
      target = argv[i];
      continue;
    }
    if (arg === "--outfile") {
      i += 1;
      const value = argv[i];
      if (value !== undefined) outfile = value;
      continue;
    }
    if (arg === "--release-tag") {
      i += 1;
      releaseTag = argv[i];
    }
  }

  return { target, outfile, releaseTag };
}

function gitSha(): string {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"]);
  if (result.exitCode !== 0) return "";
  return result.stdout.toString().trim();
}

function isDirty(): boolean {
  const result = Bun.spawnSync(["git", "status", "--porcelain"]);
  if (result.exitCode !== 0) return false;
  return result.stdout.toString().trim().length > 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const { target, outfile, releaseTag } = parseArgs(argv);

  if (releaseTag !== undefined && !/^v/.test(releaseTag)) {
    console.error(`scripts/build.ts: --release-tag must start with "v", got "${releaseTag}"`);
    return 2;
  }

  const sha = gitSha();
  const dirty = sha !== "" && isDirty();

  const buildArgs = [
    "build",
    "./src/cli.ts",
    "--compile",
    "--outfile",
    outfile,
    "--define",
    `process.env.DH_BUILD_GIT_SHA=${JSON.stringify(sha)}`,
    "--define",
    `process.env.DH_BUILD_DIRTY=${JSON.stringify(dirty ? "true" : "false")}`,
    "--define",
    `process.env.DH_BUILD_RELEASE_TAG=${JSON.stringify(releaseTag ?? "")}`,
  ];
  if (target !== undefined) {
    buildArgs.push("--target", target);
  }

  const result = Bun.spawnSync(["bun", ...buildArgs], { stdout: "inherit", stderr: "inherit" });

  const stampParts = [sha ? sha.slice(0, 12) : "unstamped"];
  if (dirty) stampParts.push("dirty");
  if (releaseTag) stampParts.push(releaseTag);
  console.log(`scripts/build.ts: stamped build ${outfile} (${stampParts.join(", ")})`);

  return result.exitCode ?? 1;
}

if (import.meta.main) {
  process.exit(await main());
}
