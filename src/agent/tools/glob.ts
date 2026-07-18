// Glob tool (DH-0054: tracking/DH-0054-no-first-class-grep-glob-tools.md) — fast file-path
// glob matching, structured (a plain list of matched paths) and cross-platform, mirroring
// Claude Code's Glob tool. Before this, search was entirely delegated to shelling out via
// Bash (`find`), which works but is weaker than a purpose-built tool: shell-quoting footguns,
// inconsistent `find` flags across OS, and unstructured text output the model has to parse.

import { stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { capOutput } from "./output-cap.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";

function resolvePath(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

export const globTool: Tool = Object.freeze<Tool>({
  name: "Glob",
  description:
    "Fast file-path glob matching (e.g. '**/*.ts', 'src/**/*.test.ts'). Returns matching " +
    "paths, sorted by modification time (most recent first) — the same convention Claude " +
    "Code's own Glob tool uses, so the most likely-relevant recently-touched files surface " +
    "first. Prefer this over Bash's `find` for glob-shaped searches: structured output, no " +
    "shell-quoting risk, consistent behavior across OS.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern to match file paths against (e.g. '**/*.ts').",
      },
      path: {
        type: "string",
        description: "Directory to search within; defaults to the working directory.",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const pattern = input.pattern;
    if (typeof pattern !== "string" || pattern.length === 0) {
      return { output: "Glob tool error: 'pattern' must be a non-empty string.", isError: true };
    }
    const path = input.path;
    if (path !== undefined && typeof path !== "string") {
      return { output: "Glob tool error: 'path' must be a string when provided.", isError: true };
    }

    const base = resolvePath(path ?? ".", ctx.cwd);
    const baseStats = await stat(base).catch(() => null);
    if (baseStats === null || !baseStats.isDirectory()) {
      return {
        output: `Glob tool error: 'path' does not exist or is not a directory: ${base}`,
        isError: true,
      };
    }

    // Bun.Glob's constructor doesn't validate/throw on a malformed pattern (unlike `new
    // RegExp(...)`) — an unmatchable pattern just yields zero scan results, handled by the
    // "No files matched." branch below like any other non-matching pattern.
    const glob = new Bun.Glob(pattern);

    const matches: { path: string; mtimeMs: number }[] = [];
    for await (const rel of glob.scan({ cwd: base, dot: false })) {
      const abs = join(base, rel);
      const stats = await stat(abs).catch(() => null);
      matches.push({ path: abs, mtimeMs: stats?.mtimeMs ?? 0 });
    }

    if (matches.length === 0) {
      return { output: "No files matched.", isError: false };
    }

    matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const capped = capOutput(matches.map((m) => m.path).join("\n"));
    return { output: capped.text, isError: false };
  },
});
