// Grep tool (DH-0054: tracking/DH-0054-no-first-class-grep-glob-tools.md) — structured,
// cross-platform content search by regex (JS RegExp syntax), mirroring Claude Code's Grep
// tool. Before this, search was entirely delegated to shelling out via Bash (`grep`/`rg`),
// which works but comes with shell-quoting footguns and unstructured text output; this
// returns clean, predictable results (matched files, or matched lines with file:line, or
// per-file counts) without spawning a subprocess or depending on a system `grep` binary.
//
// DH-0072 (tracking/DH-0072-...): added -A/-B/-C context-line flags, 'multiline' mode, and
// a 'type' file-type filter for parameter parity with real Claude Code's Grep. This session
// did not have direct access to a real Grep tool to empirically verify exact flag
// interactions — implemented from the ticket's written spec; see docs/roster/grace.md for
// the judgment calls made where the spec left behavior underspecified.

import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { capOutput } from "./output-cap.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8_000;
const DEFAULT_HEAD_LIMIT = 200;

// Curated extension-to-language map for the 'type' filter. Not exhaustive — covers the
// languages a coding agent is most likely to search for, per DH-0072's brief.
const TYPE_EXTENSIONS: Record<string, string[]> = {
  js: [".js", ".jsx", ".mjs", ".cjs"],
  ts: [".ts", ".tsx", ".mts", ".cts"],
  tsx: [".tsx"],
  jsx: [".jsx"],
  py: [".py", ".pyi"],
  python: [".py", ".pyi"],
  rust: [".rs"],
  rs: [".rs"],
  go: [".go"],
  golang: [".go"],
  java: [".java"],
  kotlin: [".kt", ".kts"],
  scala: [".scala"],
  c: [".c", ".h"],
  cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"],
  csharp: [".cs"],
  cs: [".cs"],
  ruby: [".rb"],
  rb: [".rb"],
  php: [".php"],
  swift: [".swift"],
  sh: [".sh", ".bash", ".zsh"],
  bash: [".sh", ".bash"],
  html: [".html", ".htm"],
  css: [".css", ".scss", ".sass", ".less"],
  json: [".json"],
  yaml: [".yaml", ".yml"],
  toml: [".toml"],
  md: [".md", ".markdown"],
  markdown: [".md", ".markdown"],
  sql: [".sql"],
};

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
 * hardcoded pruning rather than reading `.gitignore`, kept deliberately simple. Further
 * narrowed by `extensions` (from the 'type' filter) when provided. */
async function listFiles(
  base: string,
  globPattern: string | undefined,
  extensions: string[] | undefined,
): Promise<string[]> {
  const glob = new Bun.Glob(globPattern ?? "**/*");
  const results: string[] = [];
  for await (const rel of glob.scan({ cwd: base, dot: false })) {
    if (rel.split("/").some((segment) => segment === "node_modules")) continue;
    if (extensions && !extensions.some((ext) => rel.endsWith(ext))) continue;
    const abs = join(base, rel);
    const stats = await stat(abs).catch(() => null);
    if (stats?.isFile()) results.push(abs);
  }
  return results;
}

type OutputMode = "files_with_matches" | "content" | "count";

/** Builds the displayed content lines for one file's matches, honoring -A/-B/-C context.
 * `matchedLineIdxs` are 0-based line indices that contain a match. When `before`/`after` are
 * both 0, this reduces to the plain "one line per match" behavior (no context, no group
 * separators) that predates DH-0072. When context is requested, non-matching context lines
 * are included (marked with '-' instead of ':', ripgrep-style) and non-contiguous groups of
 * lines are separated by a "--" line. */
function buildContentLines(
  lines: string[],
  matchedLineIdxs: Set<number>,
  displayPath: string,
  showLineNumbers: boolean,
  before: number,
  after: number,
): string[] {
  if (matchedLineIdxs.size === 0) return [];
  const included = new Map<number, boolean>();
  for (const m of matchedLineIdxs) {
    const start = Math.max(0, m - before);
    const end = Math.min(lines.length - 1, m + after);
    for (let i = start; i <= end; i++) {
      included.set(i, included.get(i) === true || i === m);
    }
  }
  const useSeparators = before > 0 || after > 0;
  const idxs = [...included.keys()].sort((a, b) => a - b);
  const out: string[] = [];
  let prev = -2;
  for (const i of idxs) {
    if (useSeparators && prev !== -2 && i !== prev + 1) out.push("--");
    const isMatch = included.get(i) === true;
    const sep = isMatch ? ":" : "-";
    const text = lines[i] ?? "";
    out.push(
      showLineNumbers ? `${displayPath}${sep}${i + 1}${sep}${text}` : `${displayPath}${sep}${text}`,
    );
    prev = i;
  }
  return out;
}

/** Finds matches within one file's text, returning the 0-based line indices that contain a
 * match and the total match count. In line-by-line mode (default), each line is tested
 * independently and the count is the number of matching lines. In `multiline` mode, the
 * whole file is scanned as one block (so `.` in `pattern` matches newlines and patterns can
 * span line boundaries); the count is the number of distinct matches found, and every line a
 * match spans is recorded as a matched line index. */
function findMatches(
  text: string,
  lines: string[],
  regex: RegExp,
  multiline: boolean,
): { matchedLineIdxs: Set<number>; count: number } {
  const matchedLineIdxs = new Set<number>();
  let count = 0;

  if (!multiline) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (regex.test(line)) {
        count += 1;
        matchedLineIdxs.add(i);
      }
    }
    return { matchedLineIdxs, count };
  }

  const flags = `g${regex.flags.includes("i") ? "i" : ""}s`;
  const globalRegex = new RegExp(regex.source, flags);
  let match: RegExpExecArray | null;
  while (true) {
    match = globalRegex.exec(text);
    if (match === null) break;
    count += 1;
    const startIdx = match.index;
    const endIdx = startIdx + Math.max(match[0].length, 1) - 1;
    const startLine = countNewlines(text, startIdx);
    const endLine = countNewlines(text, endIdx);
    for (let i = startLine; i <= endLine; i++) matchedLineIdxs.add(i);
    if (match[0].length === 0) globalRegex.lastIndex += 1;
  }
  return { matchedLineIdxs, count };
}

function countNewlines(text: string, upToIndex: number): number {
  let n = 0;
  for (let i = 0; i < upToIndex && i < text.length; i++) {
    if (text[i] === "\n") n += 1;
  }
  return n;
}

export const grepTool: Tool = {
  name: "Grep",
  description:
    "Search file contents by regular expression (JS RegExp syntax). Searches a single file, " +
    "or every file under a directory (optionally filtered by 'glob', e.g. '**/*.ts', or by " +
    "'type', e.g. 'ts'/'py'/'rust' — a curated language extension filter, use instead of " +
    "hand-rolling a glob). 'output_mode' controls the shape of results: 'files_with_matches' " +
    "(default) lists matching file paths; 'content' lists matching lines as " +
    "'path:line:text'; 'count' lists per-file match counts. In 'content' mode, '-A'/'-B'/" +
    "'-C' add N lines of context after/before/both around each match (context-only lines " +
    "are shown as 'path-line-text'); these are rejected in other output modes since there's " +
    "no line content to show context around. 'multiline' (default false) lets '.' match " +
    "newlines and searches each file as one block instead of line-by-line, for patterns " +
    "that span multiple lines. Structured output, no shell-quoting risk, consistent across " +
    "OS — prefer this over Bash's `grep`/`rg` for content search.",
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
      type: {
        type: "string",
        description:
          "File type/language filter (e.g. 'ts', 'py', 'rust', 'go'), when 'path' is a " +
          "directory. Alternative to 'glob'; both may be combined.",
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
      "-A": {
        type: "number",
        description: "In 'content' mode, show N lines of context after each match.",
      },
      "-B": {
        type: "number",
        description: "In 'content' mode, show N lines of context before each match.",
      },
      "-C": {
        type: "number",
        description: "In 'content' mode, show N lines of context before and after each match.",
      },
      multiline: {
        type: "boolean",
        description:
          "When true, '.' matches newlines and the file is searched as one block instead of " +
          "line-by-line, so patterns can span multiple lines (default false).",
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
    const fileType = input.type;
    if (fileType !== undefined && typeof fileType !== "string") {
      return { output: "Grep tool error: 'type' must be a string when provided.", isError: true };
    }
    let typeExtensions: string[] | undefined;
    if (fileType !== undefined) {
      typeExtensions = TYPE_EXTENSIONS[fileType];
      if (!typeExtensions) {
        return {
          output:
            `Grep tool error: unknown 'type': ${fileType}. Known types: ` +
            `${Object.keys(TYPE_EXTENSIONS).sort().join(", ")}.`,
          isError: true,
        };
      }
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
    if (input.multiline !== undefined && typeof input.multiline !== "boolean") {
      return {
        output: "Grep tool error: 'multiline' must be a boolean when provided.",
        isError: true,
      };
    }
    const multiline = input.multiline === true;

    const contextFields: [string, unknown][] = [
      ["-A", input["-A"]],
      ["-B", input["-B"]],
      ["-C", input["-C"]],
    ];
    for (const [name, value] of contextFields) {
      if (
        value !== undefined &&
        (typeof value !== "number" || value < 0 || !Number.isInteger(value))
      ) {
        return {
          output: `Grep tool error: '${name}' must be a non-negative integer when provided.`,
          isError: true,
        };
      }
    }
    const hasContextFlags = contextFields.some(([, value]) => value !== undefined);
    if (hasContextFlags && outputMode !== "content") {
      return {
        output:
          "Grep tool error: '-A'/'-B'/'-C' only apply when output_mode is 'content' " +
          "(there are no surrounding lines to show in 'files_with_matches' or 'count').",
        isError: true,
      };
    }
    const contextBefore =
      (input["-B"] as number | undefined) ?? (input["-C"] as number | undefined) ?? 0;
    const contextAfter =
      (input["-A"] as number | undefined) ?? (input["-C"] as number | undefined) ?? 0;

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

    const files = stats.isFile()
      ? [absPath]
      : await listFiles(absPath, globPattern, typeExtensions);

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
      const displayPath = stats.isFile() ? file : relative(absPath, file) || file;
      const { matchedLineIdxs, count } = findMatches(text, lines, regex, multiline);
      if (count > 0) {
        filesWithMatches.push(displayPath);
        counts.push({ path: displayPath, count });
        if (outputMode === "content") {
          contentLines.push(
            ...buildContentLines(
              lines,
              matchedLineIdxs,
              displayPath,
              showLineNumbers,
              contextBefore,
              contextAfter,
            ),
          );
        }
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
