// Grep tool (DH-0054: tracking/DH-0054-no-first-class-grep-glob-tools.md) — structured,
// cross-platform content search by regex (JS RegExp syntax), mirroring Claude Code's Grep
// tool. Before this, search was entirely delegated to shelling out via Bash (`grep`/`rg`),
// which works but comes with shell-quoting footguns and unstructured text output; this
// returns clean, predictable results (matched files, or matched lines with file:line, or
// per-file counts) without spawning a subprocess or depending on a system `grep` binary.

import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { capOutput } from "./output-cap.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8_000;
const DEFAULT_HEAD_LIMIT = 200;

function resolvePath(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function looksBinary(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

async function isReadableTextFile(absPath: string): Promise<boolean> {
  const file = Bun.file(absPath);
  if (file.size === 0 || file.size > MAX_FILE_BYTES) return file.size === 0;
  const sniffSize = Math.min(file.size, BINARY_SNIFF_BYTES);
  const bytes = new Uint8Array(await file.slice(0, sniffSize).arrayBuffer());
  return !looksBinary(bytes);
}

/** Lists candidate files under `base` matching `globPattern` (default: every file), skipping
 * directories whose name starts with `.` and (git's own convention) `node_modules` — cheap,
 * hardcoded pruning rather than reading `.gitignore`, kept deliberately simple. */
async function listFiles(base: string, globPattern: string | undefined): Promise<string[]> {
  const glob = new Bun.Glob(globPattern ?? "**/*");
  const results: string[] = [];
  for await (const rel of glob.scan({ cwd: base, dot: false })) {
    if (rel.split("/").some((segment) => segment === "node_modules")) continue;
    const abs = join(base, rel);
    const stats = await stat(abs).catch(() => null);
    if (stats?.isFile()) results.push(abs);
  }
  return results;
}

type OutputMode = "files_with_matches" | "content" | "count";

export const grepTool: Tool = {
  name: "Grep",
  description:
    "Search file contents by regular expression (JS RegExp syntax). Searches a single file, " +
    "or every file under a directory (optionally filtered by 'glob', e.g. '**/*.ts'). " +
    "'output_mode' controls the shape of results: 'files_with_matches' (default) lists " +
    "matching file paths; 'content' lists matching lines as 'path:line:text'; 'count' lists " +
    "per-file match counts. Structured output, no shell-quoting risk, consistent across OS " +
    "— prefer this over Bash's `grep`/`rg` for content search.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regular expression (JS RegExp syntax) to search for.",
      },
      path: {
        type: "string",
        description: "File or directory to search; defaults to the working directory.",
      },
      glob: {
        type: "string",
        description: "Glob filter for which files to search, when 'path' is a directory.",
      },
      output_mode: {
        type: "string",
        description: "'files_with_matches' (default), 'content', or 'count'.",
      },
      "-i": { type: "boolean", description: "Case-insensitive match." },
      "-n": {
        type: "boolean",
        description: "In 'content' mode, prefix each line with its line number.",
      },
      head_limit: {
        type: "number",
        description: "Cap the number of results returned (default 200).",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const pattern = input.pattern;
    if (typeof pattern !== "string" || pattern.length === 0) {
      return { output: "Grep tool error: 'pattern' must be a non-empty string.", isError: true };
    }
    const path = input.path;
    if (path !== undefined && typeof path !== "string") {
      return { output: "Grep tool error: 'path' must be a string when provided.", isError: true };
    }
    const globPattern = input.glob;
    if (globPattern !== undefined && typeof globPattern !== "string") {
      return { output: "Grep tool error: 'glob' must be a string when provided.", isError: true };
    }
    const outputMode = (input.output_mode ?? "files_with_matches") as OutputMode;
    if (!["files_with_matches", "content", "count"].includes(outputMode)) {
      return {
        output: "Grep tool error: 'output_mode' must be one of files_with_matches, content, count.",
        isError: true,
      };
    }
    const caseInsensitive = input["-i"] === true;
    const showLineNumbers = input["-n"] === true;
    const headLimit = input.head_limit;
    if (headLimit !== undefined && (typeof headLimit !== "number" || headLimit < 1)) {
      return { output: "Grep tool error: 'head_limit' must be a positive number.", isError: true };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, caseInsensitive ? "i" : "");
    } catch (err) {
      return {
        output: `Grep tool error: invalid regular expression: ${(err as Error).message}`,
        isError: true,
      };
    }

    const absPath = resolvePath(path ?? ".", ctx.cwd);
    const stats = await stat(absPath).catch(() => null);
    if (stats === null) {
      return { output: `Grep tool error: path does not exist: ${absPath}`, isError: true };
    }

    const files = stats.isFile() ? [absPath] : await listFiles(absPath, globPattern);

    const filesWithMatches: string[] = [];
    const contentLines: string[] = [];
    const counts: { path: string; count: number }[] = [];

    for (const file of files) {
      if (!(await isReadableTextFile(file))) continue;
      const text = await Bun.file(file)
        .text()
        .catch(() => null);
      if (text === null) continue;

      const lines = text.split("\n");
      let fileCount = 0;
      const displayPath = stats.isFile() ? file : relative(absPath, file) || file;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (regex.test(line)) {
          fileCount += 1;
          if (outputMode === "content") {
            contentLines.push(
              showLineNumbers ? `${displayPath}:${i + 1}:${line}` : `${displayPath}:${line}`,
            );
          }
        }
      }
      if (fileCount > 0) {
        filesWithMatches.push(displayPath);
        counts.push({ path: displayPath, count: fileCount });
      }
    }

    const limit = headLimit ?? DEFAULT_HEAD_LIMIT;
    let resultLines: string[];
    if (outputMode === "files_with_matches") {
      resultLines = filesWithMatches;
    } else if (outputMode === "count") {
      resultLines = counts.map((c) => `${c.path}:${c.count}`);
    } else {
      resultLines = contentLines;
    }

    if (resultLines.length === 0) {
      return { output: "No matches found.", isError: false };
    }

    const truncated = resultLines.length > limit;
    const shown = resultLines.slice(0, limit);
    const notice = truncated
      ? `\n\n<system-reminder>Results truncated: showing ${limit} of ${resultLines.length} total. Narrow 'pattern'/'glob'/'path', or pass a larger 'head_limit', to see more.</system-reminder>`
      : "";
    const capped = capOutput(shown.join("\n") + notice);
    return { output: capped.text, isError: false };
  },
};
