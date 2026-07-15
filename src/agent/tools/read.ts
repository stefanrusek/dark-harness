// Read tool — reads a file from disk, cat -n style (line numbers), with optional
// offset/limit. Mirrors Claude Code's Read tool semantics.

import { isAbsolute, resolve } from "node:path";
import { recordRead } from "./read-guard.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
// Round 13 (docs/handoffs/core.md, P1 item 7): sampled prefix for binary detection — large
// enough to catch binary formats' headers/magic bytes without reading (and decoding) an
// entire large file just to reject it.
const BINARY_SNIFF_BYTES = 8_000;

function resolvePath(filePath: string, cwd: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

/** Round 13: a NUL byte anywhere in the sampled prefix is a reliable binary signal — no valid
 * UTF-8 text file legitimately contains one. Cheap and doesn't require a full decode attempt. */
function looksBinary(bytes: Uint8Array): boolean {
  const sampleLength = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < sampleLength; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

export const readTool: Tool = {
  name: "Read",
  description:
    "Read a file from the local filesystem, returned with cat -n style line numbers. " +
    "Truncates to at most 2000 lines by default (override with 'limit'); when truncated, a " +
    "notice states how many lines remain. Refuses binary files with a clear error instead of " +
    "returning decoded garbage.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute or cwd-relative path to read." },
      offset: { type: "number", description: "1-based line number to start reading from." },
      limit: { type: "number", description: "Maximum number of lines to read." },
    },
    required: ["file_path"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const filePath = input.file_path;
    if (typeof filePath !== "string" || filePath.length === 0) {
      return { output: "Read tool error: 'file_path' must be a non-empty string.", isError: true };
    }

    const offset = input.offset;
    if (offset !== undefined && (typeof offset !== "number" || offset < 1)) {
      return {
        output: "Read tool error: 'offset' must be a 1-based positive number.",
        isError: true,
      };
    }
    const limit = input.limit;
    if (limit !== undefined && (typeof limit !== "number" || limit < 1)) {
      return { output: "Read tool error: 'limit' must be a positive number.", isError: true };
    }

    const absPath = resolvePath(filePath, ctx.cwd);
    const file = Bun.file(absPath);
    if (!(await file.exists())) {
      return { output: `Read tool error: file does not exist: ${absPath}`, isError: true };
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    // Round 13: record the read regardless of outcome below (empty/binary/normal) — the
    // model genuinely did read this path at this point in time, which is what Edit/Write's
    // read-before-write guard (read-guard.ts) needs to know.
    await recordRead(ctx, absPath);

    if (bytes.length === 0) {
      return {
        output: "<system-reminder>File exists but has empty contents.</system-reminder>",
        isError: false,
      };
    }

    if (looksBinary(bytes)) {
      return {
        output: `Read tool error: binary file, ${bytes.length} bytes. Refusing to decode as text.`,
        isError: true,
      };
    }

    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

    const lines = text.split("\n");
    const startIndex = offset !== undefined ? offset - 1 : 0;
    const maxLines = limit !== undefined ? limit : DEFAULT_LIMIT;
    const endIndex = Math.min(startIndex + maxLines, lines.length);
    const slice = lines.slice(startIndex, endIndex);

    const formatted = slice
      .map((line, i) => {
        const lineNo = startIndex + i + 1;
        const truncated =
          line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line;
        return `${String(lineNo).padStart(6, " ")}\t${truncated}`;
      })
      .join("\n");

    const remaining = lines.length - endIndex;
    if (remaining > 0) {
      return {
        output: `${formatted}\n\n<system-reminder>File truncated: ${remaining} more line${remaining === 1 ? "" : "s"} not shown. Pass a larger 'limit' or a later 'offset' to continue reading.</system-reminder>`,
        isError: false,
      };
    }

    return { output: formatted, isError: false };
  },
};
