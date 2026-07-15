// Spawns the real compiled `dh` binary as an actual OS subprocess (ADR 0008 — never
// `bun run src/cli.ts` in-process) and gives tests a way to (a) wait for a line of stdout
// matching a pattern (e.g. "listening on port N") without racing the process's own startup
// time, and (b) inspect accumulated stdout/stderr/exit code afterwards.

import { ensureBuilt } from "./build.ts";

export interface SpawnDhOptions {
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  /** Extra env vars merged on top of `process.env` (default) or `env` if given. */
  extraEnv?: Record<string, string>;
}

export interface DhProcess {
  readonly proc: ReturnType<typeof Bun.spawn>;
  stdout(): string;
  stderr(): string;
  /** Resolves once accumulated stdout matches `pattern`, or rejects after `timeoutMs`. */
  waitForStdout(pattern: RegExp, timeoutMs?: number): Promise<string>;
  /** Resolves with the process's exit code, or rejects after `timeoutMs`. */
  waitForExit(timeoutMs?: number): Promise<number>;
  kill(): void;
}

async function pump(
  stream: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) onChunk(decoder.decode(value, { stream: true }));
  }
}

export async function spawnDh(options: SpawnDhOptions): Promise<DhProcess> {
  const binaryPath = await ensureBuilt();

  let stdoutBuf = "";
  let stderrBuf = "";
  const stdoutWaiters: { pattern: RegExp; resolve: (s: string) => void }[] = [];

  const proc = Bun.spawn({
    cmd: [binaryPath, ...options.args],
    cwd: options.cwd,
    env: { ...(options.env ?? process.env), ...(options.extraEnv ?? {}) },
    stdout: "pipe",
    stderr: "pipe",
  });

  void pump(proc.stdout as ReadableStream<Uint8Array>, (chunk) => {
    stdoutBuf += chunk;
    for (let i = stdoutWaiters.length - 1; i >= 0; i -= 1) {
      const waiter = stdoutWaiters[i];
      if (waiter?.pattern.test(stdoutBuf)) {
        stdoutWaiters.splice(i, 1);
        waiter.resolve(stdoutBuf);
      }
    }
  });
  void pump(proc.stderr as ReadableStream<Uint8Array>, (chunk) => {
    stderrBuf += chunk;
  });

  return {
    proc,
    stdout: () => stdoutBuf,
    stderr: () => stderrBuf,
    waitForStdout(pattern, timeoutMs = 10_000) {
      if (pattern.test(stdoutBuf)) return Promise.resolve(stdoutBuf);
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = stdoutWaiters.findIndex((w) => w.resolve === wrappedResolve);
          if (idx >= 0) stdoutWaiters.splice(idx, 1);
          reject(
            new Error(
              `timed out after ${timeoutMs}ms waiting for stdout to match ${pattern}. ` +
                `stdout so far:\n${stdoutBuf}\nstderr so far:\n${stderrBuf}`,
            ),
          );
        }, timeoutMs);
        const wrappedResolve = (s: string) => {
          clearTimeout(timer);
          resolve(s);
        };
        stdoutWaiters.push({ pattern, resolve: wrappedResolve });
      });
    },
    async waitForExit(timeoutMs = 15_000) {
      const timeout = new Promise<number>((_, reject) => {
        setTimeout(
          () => reject(new Error(`process did not exit within ${timeoutMs}ms`)),
          timeoutMs,
        );
      });
      return Promise.race([proc.exited, timeout]);
    },
    kill() {
      try {
        proc.kill();
      } catch {
        // already dead
      }
    },
  };
}
