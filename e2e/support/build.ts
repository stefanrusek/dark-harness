// Builds the real `dh` binary once per `bun test e2e` run (ADR 0008: e2e drives the actual
// compiled binary, never `bun run src/cli.ts` in-process). Every support module that needs
// the binary path calls `ensureBuilt()`; the underlying `bun build --compile` only runs once
// no matter how many test files (or `beforeAll` hooks) request it, because `bun test`
// executes every test file in one process and this module's cache is a plain top-level
// singleton shared across those imports.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");
export const DH_BINARY_PATH = resolve(REPO_ROOT, "dist", "dh");

let buildPromise: Promise<string> | null = null;

async function build(): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["bun", "build", "./src/cli.ts", "--compile", "--outfile", "dist/dh"],
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
    throw new Error(`bun build --compile failed (exit ${exitCode}):\n${stdout}\n${stderr}`);
  }
  if (!existsSync(DH_BINARY_PATH)) {
    throw new Error(`bun build --compile reported success but ${DH_BINARY_PATH} is missing`);
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
