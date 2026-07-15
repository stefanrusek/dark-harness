// Write tool — creates or overwrites a file, creating parent directories as needed. Mirrors
// Claude Code's Write tool.

import { isAbsolute, resolve } from "node:path";
import { checkReadBeforeWrite, recordRead } from "./read-guard.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

function resolvePath(filePath: string, cwd: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

export const writeTool: Tool = {
  name: "Write",
  description:
    "Create or overwrite a file with the given content, creating parent directories as needed.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      content: { type: "string" },
    },
    required: ["file_path", "content"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const filePath = input.file_path;
    const content = input.content;
    if (typeof filePath !== "string" || filePath.length === 0) {
      return { output: "Write tool error: 'file_path' must be a non-empty string.", isError: true };
    }
    if (typeof content !== "string") {
      return { output: "Write tool error: 'content' must be a string.", isError: true };
    }

    const absPath = resolvePath(filePath, ctx.cwd);

    // Round 13 (docs/handoffs/core.md): only overwriting an *existing* path needs a prior
    // Read — creating a brand-new file has nothing to blindly clobber.
    if (await Bun.file(absPath).exists()) {
      const guardError = await checkReadBeforeWrite(ctx, absPath, "Write");
      if (guardError) {
        return { output: guardError.error, isError: true };
      }
    }

    try {
      await Bun.write(absPath, content);
    } catch (err) {
      return {
        output: `Write tool error: failed to write ${absPath}: ${(err as Error).message}`,
        isError: true,
      };
    }
    await recordRead(ctx, absPath);

    return { output: `Wrote ${content.length} bytes to ${absPath}.`, isError: false };
  },
};
