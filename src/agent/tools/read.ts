// Read tool — reads a file from disk, cat -n style (line numbers), with optional
// offset/limit. Mirrors Claude Code's Read tool semantics.

import { isAbsolute, resolve } from "node:path";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

function resolvePath(filePath: string, cwd: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

export const readTool: Tool = {
  name: "Read",
  description: "Read a file from the local filesystem, returned with cat -n style line numbers.",
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

    const text = await file.text();

    if (text.length === 0) {
      return {
        output: "<system-reminder>File exists but has empty contents.</system-reminder>",
        isError: false,
      };
    }

    const lines = text.split("\n");
    const startIndex = offset !== undefined ? offset - 1 : 0;
    const maxLines = limit !== undefined ? limit : DEFAULT_LIMIT;
    const slice = lines.slice(startIndex, startIndex + maxLines);

    const formatted = slice
      .map((line, i) => {
        const lineNo = startIndex + i + 1;
        const truncated =
          line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line;
        return `${String(lineNo).padStart(6, " ")}\t${truncated}`;
      })
      .join("\n");

    return { output: formatted, isError: false };
  },
};
