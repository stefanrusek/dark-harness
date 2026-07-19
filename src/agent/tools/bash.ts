// Bash tool — runs a shell command via `bash -c`. Mirrors Claude Code's Bash tool: merges
// stdout+stderr in output order as best-effort, supports a timeout, and supports
// run_in_background (HANDOFF.md §4 — default true, overridable by
// options.runInBackgroundDefault / the per-call flag).
//
// Round 13 (docs/handoffs/core.md) divergence, documented rather than "fixed" per Fable's
// adopted recommendation: every call is a fresh `bash -c` at ctx.cwd — a `cd` in one call
// does NOT persist to the next call, unlike a real interactive shell. This matches how real
// Claude Code's own *subagent* Bash threads behave, not a novel choice; see the tool
// description below, which states this explicitly for the model.
//
// DH-0011 fix (tracking/DH-0011-no-signal-handling-or-process-group-reaping.md): the
// timeout/abort path used to only call `proc.kill()` on the immediate `bash -c` process —
// anything that command backgrounded itself (`sleep 300 &`, a daemon it started) kept running
// as an orphan/zombie after the tool call "ended". Fixed by spawning with `detached: true`
// (POSIX: `setsid()`, making the `bash -c` process the leader of a brand-new process group)
// and killing the *group* (`process.kill(-pid, signal)`, the POSIX convention for "negative
// pid targets the process group") on both the timeout path and the AbortSignal path, before
// falling back to killing just the immediate process if the group kill fails for any reason
// (e.g. the process already exited, or already reaped its own children).

import { capOutputWithSavedFile } from "./output-cap.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";
import { validateInput } from "./validate-input.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

interface RunResult {
  exitCode: number;
  timedOut: boolean;
}

async function pipeToBuffer(
  stream: ReadableStream<Uint8Array> | undefined,
  append: (chunk: string) => void,
): Promise<void> {
  if (!stream) return;
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    append(decoder.decode(chunk, { stream: true }));
  }
  append(decoder.decode());
}

/** Kills `proc`'s entire process group (DH-0011) — falls back to killing just the immediate
 * process if the group kill fails (e.g. it already exited, or `pid` isn't a valid group
 * leader for any reason). `detached: true` at spawn time (below) is what makes `proc.pid` the
 * leader of its own process group in the first place, so `-pid` addresses that whole group,
 * POSIX's convention for "negative pid" in `kill(2)`. */
export function killProcessGroup(proc: { pid: number; kill: () => void }): void {
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    proc.kill();
  }
}

async function runCommand(
  command: string,
  cwd: string,
  signal: AbortSignal,
  timeoutMs: number,
  append: (chunk: string) => void,
): Promise<RunResult> {
  const proc = Bun.spawn(["bash", "-c", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    // DH-0011: NOT passing `signal` directly here — Bun's own signal-triggered kill only ever
    // kills this immediate process, not its process group. The abort listener below does a
    // full group kill instead, exactly like the timeout path.
    detached: true,
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProcessGroup(proc);
  }, timeoutMs);

  const onAbort = () => killProcessGroup(proc);
  signal.addEventListener("abort", onAbort);
  if (signal.aborted) onAbort();

  try {
    await Promise.all([
      pipeToBuffer(proc.stdout as ReadableStream<Uint8Array>, append),
      pipeToBuffer(proc.stderr as ReadableStream<Uint8Array>, append),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, timedOut };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

// Round 13 (docs/handoffs/core.md, P1 item 2): real Claude Code's Bash tool names this
// parameter `timeout` (milliseconds), not `timeout_ms` — and unknown JSON-schema properties
// are silently dropped by providers, so a model trained on the real convention emitting
// `timeout: 600000` was previously ignored outright, silently running with the 120s default.
// `timeout` is now the primary/documented name; `timeout_ms` remains accepted as a back-compat
// alias. If both are provided, `timeout` wins.
function resolveTimeout(input: Record<string, unknown>): number {
  const raw = input.timeout ?? input.timeout_ms;
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error("timeout must be a positive number (milliseconds) when provided");
  }
  return Math.min(raw, MAX_TIMEOUT_MS);
}

export const bashTool: Tool = Object.freeze<Tool>({
  name: "Bash",
  description:
    "Run a shell command via bash -c in the working directory. Supports run_in_background " +
    "(default true) to run concurrently and be observed later via Monitor/TaskOutput/TaskStop. " +
    "Output returned to you is capped: past the cap, the full output is saved to a file and " +
    "you're shown a head preview (plus a short tail preview) and the saved path, so you can " +
    "Read the rest if needed. Statelessness note: each call is a fresh shell at the " +
    "working directory — `cd` and other shell state do NOT persist between calls; use " +
    "absolute paths, or chain with && in one call, instead of relying on a prior `cd`.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to run." },
      description: {
        type: "string",
        description: "Short human-readable description of the command.",
      },
      timeout: { type: "number", description: "Max time to allow the command to run, in ms." },
      timeout_ms: {
        type: "number",
        description: "Deprecated alias for 'timeout'; 'timeout' takes precedence if both given.",
      },
      run_in_background: { type: "boolean" },
    },
    required: ["command"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    // Scoped to 'command' only (not the whole inputSchema) — 'timeout'/'timeout_ms' keep
    // their own resolveTimeout() logic (positivity + alias precedence beyond plain typeof),
    // and 'run_in_background' has no error path at all (it just falls back to the ctx
    // default), so running the shared validator over the full schema here would risk
    // pre-empting that tool-specific logic with a generically-worded error instead.
    const validation = validateInput(
      {
        type: "object",
        properties: { command: bashTool.inputSchema.properties.command },
        required: ["command"],
      },
      "Bash",
      input,
    );
    if (!validation.ok) return validation.result;
    const command = input.command as string;

    let timeoutMs: number;
    try {
      timeoutMs = resolveTimeout(input);
    } catch (err) {
      return { output: `Bash tool error: ${(err as Error).message}`, isError: true };
    }

    const runInBackground =
      typeof input.run_in_background === "boolean"
        ? input.run_in_background
        : ctx.runInBackgroundDefault;

    const taskId = ctx.tasks.start({
      kind: "bash",
      parentAgentId: ctx.agentId,
      background: runInBackground,
      run: async (handle) => {
        const { exitCode, timedOut } = await runCommand(
          command,
          ctx.cwd,
          handle.signal,
          timeoutMs,
          handle.append,
        );
        if (timedOut) {
          throw new Error(`command timed out after ${timeoutMs}ms`);
        }
        if (exitCode !== 0) {
          throw new Error(`command exited with code ${exitCode}`);
        }
      },
    });

    if (runInBackground) {
      return {
        output: `Started background task ${taskId}. Use Monitor/TaskOutput with this id to observe it.`,
        isError: false,
      };
    }

    await ctx.tasks.awaitDone(taskId);
    const snapshot = ctx.tasks.snapshot(taskId);
    const capped = await capOutputWithSavedFile(snapshot.output);
    if (snapshot.status === "failed") {
      return {
        output: `${capped.text}\n[error] ${snapshot.error ?? "command failed"}`,
        isError: true,
      };
    }
    return { output: capped.text, isError: false };
  },
});
