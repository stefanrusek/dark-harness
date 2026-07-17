#!/usr/bin/env bun
import { dispatch } from "./dispatch.ts";
/**
 * Combined flow for User Story 1: create (or reuse) a git worktree, dispatch a real `claude`
 * subprocess into it with the given prompt, then apply Workflow-style cleanup discipline —
 * remove the worktree if the subprocess succeeded and the worktree is clean/merged, leave it
 * in place otherwise.
 *
 * Usage:
 *   bun run-in-worktree.ts --repo <repoPath> --branch <name> --prompt "text" \
 *     [--base <ref>] [--model sonnet] [--permission-mode bypassPermissions] [--keep]
 *
 * Prints one JSON object to stdout:
 *   {
 *     ...same shape as dispatch.ts's DispatchResult,
 *     worktreePath: string,
 *     branch: string,
 *     cleanup: { removed: boolean, reason: string } | null   // null if --keep was passed
 *   }
 *
 * Process exit code mirrors the subprocess's exit code (0 = the sub-agent's claude run
 * completed successfully; nonzero = it failed or errored) so this composes with shell `&&`.
 */
import { cleanupWorktree, createWorktree } from "./worktree.ts";

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

if (import.meta.main) {
  const flags = parseFlags(process.argv.slice(2));

  const repo = String(flags.repo ?? ".");
  const branch = String(flags.branch);
  const prompt = String(flags.prompt);
  const base = flags.base ? String(flags.base) : undefined;
  const keep = Boolean(flags.keep);

  if (!branch || flags.branch === true) throw new Error("--branch is required");
  if (!prompt || flags.prompt === true) throw new Error("--prompt is required");

  const worktreePath = await createWorktree({ repo, branch, base });

  const result = await dispatch({
    dir: worktreePath,
    prompt,
    model: flags.model ? String(flags.model) : undefined,
    permissionMode: flags["permission-mode"] ? String(flags["permission-mode"]) : undefined,
    timeoutMs: flags["timeout-ms"] ? Number(flags["timeout-ms"]) : undefined,
  });

  let cleanup = null;
  if (!keep) {
    cleanup = await cleanupWorktree({
      repo,
      worktreePath,
      branch,
      base,
      force: false,
    });
  }

  console.log(
    JSON.stringify(
      {
        ...result,
        worktreePath,
        branch,
        cleanup,
      },
      null,
      2,
    ),
  );
  process.exit(result.exitCode);
}
