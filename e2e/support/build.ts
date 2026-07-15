// Builds the real `dh` binary once per `bun test e2e` run (ADR 0008: e2e drives the actual
// compiled binary, never `bun run src/cli.ts` in-process). Every support module that needs
// the binary path calls `ensureBuilt()`; the underlying build only runs once no matter how
// many test files (or `beforeAll` hooks) request it, because `bun test` executes every test
// file in one process and this module's cache is a plain top-level singleton shared across
// those imports.
//
// Round 4 (docs/handoffs/e2e.md): shells out to Core's `scripts/build.ts` rather than calling
// `bun build --compile` directly, mirroring the `package.json`/`release.yml` call-site
// pattern. That script bakes build-identity (git sha / dirty / release tag) into the binary
// via `--define` substitution — the same stamping every real build gets — which is exactly
// what `e2e/build-stamp.test.ts` asserts survives all the way through this compilation
// pipeline into the compiled binary's JSONL log header.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");
export const DH_BINARY_PATH = resolve(REPO_ROOT, "dist", "dh");

let buildPromise: Promise<string> | null = null;

async function build(): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["bun", "scripts/build.ts", "--outfile", "dist/dh"],
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`scripts/build.ts failed (exit ${exitCode}):\n${stdout}\n${stderr}`);
  }
  if (!existsSync(DH_BINARY_PATH)) {
    throw new Error(`scripts/build.ts reported success but ${DH_BINARY_PATH} is missing`);
  }
  return DH_BINARY_PATH;
}

/** Resolves to the absolute path of the compiled `dh` binary, building it on first call. */
export function ensureBuilt(): Promise<string> {
  if (!buildPromise) {
    buildPromise = build();
  }
  return buildPromise;
}
