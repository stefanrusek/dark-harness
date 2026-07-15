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

import { capOutput } from "./output-cap.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

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
    signal,
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  try {
    await Promise.all([
      pipeToBuffer(proc.stdout as ReadableStream<Uint8Array>, append),
      pipeToBuffer(proc.stderr as ReadableStream<Uint8Array>, append),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, timedOut };
  } finally {
    clearTimeout(timer);
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

export const bashTool: Tool = {
  name: "Bash",
  description:
    "Run a shell command via bash -c in the working directory. Supports run_in_background " +
    "(default true) to run concurrently and be observed later via Monitor/TaskOutput/TaskStop. " +
    "Output returned to you is capped (long output is truncated to its tail, with a notice " +
    "stating the true total size). Statelessness note: each call is a fresh shell at the " +
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
    const command = input.command;
    if (typeof command !== "string" || command.length === 0) {
      return { output: "Bash tool error: 'command' must be a non-empty string.", isError: true };
    }

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
    const capped = capOutput(snapshot.output);
    if (snapshot.status === "failed") {
      return {
        output: `${capped.text}\n[error] ${snapshot.error ?? "command failed"}`,
        isError: true,
      };
    }
    return { output: capped.text, isError: false };
  },
};
