#!/usr/bin/env bun
/**
 * Forked sub-agent dispatch: launches the `claude` CLI as a real OS subprocess with `cwd`
 * set to a target directory, waits for it to finish, and prints a JSON result comparable to
 * what the in-process `Agent` tool returns (a text summary + exit status).
 *
 * This is the low-level primitive: "run claude non-interactively in this directory with this
 * prompt". It does not know about git worktrees at all — see `worktree.ts` for creating a
 * worktree, and `run-in-worktree.ts` for the combined create -> dispatch -> cleanup flow.
 *
 * Usage:
 *   bun dispatch.ts --dir <path> --prompt "text"
 *   bun dispatch.ts --dir <path> --prompt-file <path>
 *   bun dispatch.ts --dir <path> --prompt "text" --model sonnet --permission-mode bypassPermissions
 *
 * Prints one JSON object to stdout on completion:
 *   {
 *     success: boolean,          // claude reported success (no error, normal completion)
 *     exitCode: number,          // subprocess exit code
 *     result: string,            // claude's final text output (the "summary")
 *     sessionId: string | null,
 *     costUsd: number | null,
 *     durationMs: number | null,
 *     dir: string,
 *     raw: object | null         // the full parsed --output-format json payload, if parseable
 *   }
 *
 * Process exit code mirrors the subprocess's exit code, so callers can check `$?` without
 * parsing JSON if they only care about pass/fail.
 */

interface DispatchResult {
  success: boolean;
  exitCode: number;
  result: string;
  sessionId: string | null;
  costUsd: number | null;
  durationMs: number | null;
  dir: string;
  raw: Record<string, unknown> | null;
}

function parseArgs(argv: string[]): {
  dir: string;
  prompt: string;
  model?: string;
  permissionMode?: string;
  timeoutMs?: number;
} {
  let dir: string | undefined;
  let prompt: string | undefined;
  let promptFile: string | undefined;
  let model: string | undefined;
  let permissionMode: string | undefined;
  let timeoutMs: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--dir":
        dir = argv[++i];
        break;
      case "--prompt":
        prompt = argv[++i];
        break;
      case "--prompt-file":
        promptFile = argv[++i];
        break;
      case "--model":
        model = argv[++i];
        break;
      case "--permission-mode":
        permissionMode = argv[++i];
        break;
      case "--timeout-ms":
        timeoutMs = Number(argv[++i]);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!dir) throw new Error("--dir is required");
  if (!prompt && !promptFile) throw new Error("--prompt or --prompt-file is required");
  if (prompt && promptFile) throw new Error("pass only one of --prompt / --prompt-file");

  if (promptFile) {
    prompt = require("node:fs").readFileSync(promptFile, "utf8");
  }

  return { dir: dir!, prompt: prompt!, model, permissionMode, timeoutMs };
}

export async function dispatch(opts: {
  dir: string;
  prompt: string;
  model?: string;
  permissionMode?: string;
  timeoutMs?: number;
}): Promise<DispatchResult> {
  const args = ["-p", opts.prompt, "--output-format", "json"];
  if (opts.model) args.push("--model", opts.model);
  if (opts.permissionMode) args.push("--permission-mode", opts.permissionMode);

  const proc = Bun.spawn(["claude", ...args], {
    cwd: opts.dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  let timer: Timer | undefined;
  if (opts.timeoutMs) {
    timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, opts.timeoutMs);
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  if (timer) clearTimeout(timer);

  if (timedOut) {
    return {
      success: false,
      exitCode,
      result: `Timed out after ${opts.timeoutMs}ms. stderr: ${stderr.slice(0, 2000)}`,
      sessionId: null,
      costUsd: null,
      durationMs: opts.timeoutMs ?? null,
      dir: opts.dir,
      raw: null,
    };
  }

  let raw: Record<string, unknown> | null = null;
  try {
    raw = JSON.parse(stdout);
  } catch {
    // Non-JSON output (e.g. claude itself crashed before emitting a result) — fall through
    // to a best-effort result built from raw stdout/stderr.
  }

  if (raw) {
    const isError = Boolean(raw.is_error);
    return {
      success: exitCode === 0 && !isError,
      exitCode,
      result: typeof raw.result === "string" ? raw.result : JSON.stringify(raw),
      sessionId: typeof raw.session_id === "string" ? raw.session_id : null,
      costUsd: typeof raw.total_cost_usd === "number" ? raw.total_cost_usd : null,
      durationMs: typeof raw.duration_ms === "number" ? raw.duration_ms : null,
      dir: opts.dir,
      raw,
    };
  }

  return {
    success: false,
    exitCode,
    result: stdout.trim() || stderr.trim() || "(no output)",
    sessionId: null,
    costUsd: null,
    durationMs: null,
    dir: opts.dir,
    raw: null,
  };
}

if (import.meta.main) {
  const opts = parseArgs(process.argv.slice(2));
  const result = await dispatch(opts);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.exitCode);
}
