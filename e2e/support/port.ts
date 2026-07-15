// `--server`/`--connect --port` both require a positive integer (src/cli.ts's `parseArgs`
// rejects 0), so unlike the in-process client-side servers (local web UI, local TUI's own
// DhServer) which happily bind ephemeral port 0, tests that drive `--server` as a real OS
// process need a concrete free port picked up front to avoid collisions between e2e test
// files running concurrently.
//
// DH-0034: `findFreePort` is a classic check-then-use race — it binds an ephemeral port,
// reads it, releases it, and hands the now-free number to a caller that binds it again in a
// *separate process*, moments later. Nothing stops another concurrently-running e2e test
// file (`bun test` runs files in parallel by default) from grabbing that same number in the
// gap. `findFreePort` itself can't close that gap (the real bind happens in a spawned
// subprocess, not here) — the mitigation lives in `startDhServer` below, which retries with
// a fresh port if the spawned `dh --server` process doesn't report itself listening in time
// (the observable symptom of losing the race: the OS handed the port to someone else first).

import { type DhProcess, type SpawnDhOptions, spawnDh } from "./dh-process.ts";

export async function findFreePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = server.port as number;
  server.stop(true);
  return port;
}

export interface StartDhServerOptions {
  cwd: string;
  /** Extra args appended after `--server --port <n>` (e.g. TLS/token flags aren't needed —
   * those live in `dh.json` — but reserved for future callers). */
  extraArgs?: string[];
  env?: SpawnDhOptions["env"];
  /** How many fresh-port attempts before giving up. Default 3 — generous enough to absorb
   * an unlucky collision without masking a genuinely broken binary. */
  attempts?: number;
}

/**
 * Picks a free port and spawns the real compiled `dh --server` bound to it, retrying with a
 * new port if the process doesn't confirm it's listening in time (DH-0034's mitigation for
 * `findFreePort`'s check-then-use race — see this file's header comment). Every retry kills
 * the losing attempt's process before trying again, so callers never accumulate orphaned
 * processes across retries.
 */
export async function startDhServer(
  options: StartDhServerOptions,
): Promise<{ proc: DhProcess; port: number }> {
  const attempts = options.attempts ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = await findFreePort();
    const proc = await spawnDh({
      args: ["--server", "--port", String(port), ...(options.extraArgs ?? [])],
      cwd: options.cwd,
      ...(options.env !== undefined ? { env: options.env } : {}),
    });
    try {
      await proc.waitForStdout(/listening on port/, 5_000);
      return { proc, port };
    } catch (err) {
      proc.kill();
      lastErr = err;
      // Most likely cause: another e2e test file's process won the race for this port
      // between `findFreePort()`'s check and this process's own bind attempt. Retry with a
      // freshly-checked port rather than failing the whole test on transient contention.
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`startDhServer: gave up after ${attempts} port-collision retries`);
}
