// Bash tool — runs a shell command via `bash -c`. Mirrors Claude Code's Bash tool: merges
// stdout+stderr in output order as best-effort, supports a timeout, and supports
// run_in_background (HANDOFF.md §4 — default true, overridable by
// options.runInBackgroundDefault / the per-call flag).

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

function resolveTimeout(input: Record<string, unknown>): number {
  const raw = input.timeout_ms;
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error("timeout_ms must be a positive number when provided");
  }
  return Math.min(raw, MAX_TIMEOUT_MS);
}

export const bashTool: Tool = {
  name: "Bash",
  description:
    "Run a shell command via bash -c in the working directory. Supports run_in_background " +
    "(default true) to run concurrently and be observed later via Monitor/TaskOutput/TaskStop.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to run." },
      description: {
        type: "string",
        description: "Short human-readable description of the command.",
      },
      timeout_ms: { type: "number", description: "Max time to allow the command to run, in ms." },
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
    if (snapshot.status === "failed") {
      return {
        output: `${snapshot.output}\n[error] ${snapshot.error ?? "command failed"}`,
        isError: true,
      };
    }
    return { output: snapshot.output, isError: false };
  },
};
