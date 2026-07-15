// ADR 0005 amendment / Core round 8: build identity stamped into the compiled binary at
// build time via scripts/build.ts's `--define` substitution. See that script's doc comment
// for exactly how DH_BUILD_GIT_SHA/DH_BUILD_DIRTY/DH_BUILD_RELEASE_TAG get baked in — once
// stamped, these three `process.env.*` member expressions are replaced with string literals
// at compile time (sealed against runtime env override); when running from source (`bun run
// src/cli.ts`, or a raw `bun build --compile` that bypassed the script), they fall through to
// the real `process.env`, which is normally unset, so `computeBuildInfo` sees `undefined`.

import pkg from "../../package.json" with { type: "json" };
import type { BuildInfo } from "../contracts/index.ts";

/** Pure mapping from raw stamp strings (or their absence) to a `BuildInfo`. Empty/absent
 * `gitSha`/`releaseTag` map to `null`; `dirty` is only meaningful when a `gitSha` was
 * actually obtained (an empty sha means the stamping script couldn't determine one — see
 * scripts/build.ts — so `dirty` is forced `false` in that case rather than reporting a
 * dirty-flag with no commit to anchor it to). */
export function computeBuildInfo(raw: {
  gitSha: string | undefined;
  dirty: string | undefined;
  releaseTag: string | undefined;
}): BuildInfo {
  const gitSha = raw.gitSha && raw.gitSha.length > 0 ? raw.gitSha : null;
  const releaseTag = raw.releaseTag && raw.releaseTag.length > 0 ? raw.releaseTag : null;
  return {
    version: pkg.version,
    gitSha,
    dirty: gitSha !== null && raw.dirty === "true",
    releaseTag,
  };
}

/** Process-wide build identity constant — every agent's log header (loop.ts) imports this
 * directly rather than having it threaded through as a parameter, since build identity is
 * fixed for the lifetime of the process, not per-call. */
export const BUILD_INFO: BuildInfo = computeBuildInfo({
  gitSha: process.env.DH_BUILD_GIT_SHA,
  dirty: process.env.DH_BUILD_DIRTY,
  releaseTag: process.env.DH_BUILD_RELEASE_TAG,
});
