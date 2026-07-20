// Edit tool — exact string replacement in an existing file. Mirrors Claude Code's Edit tool:
// old_string must match exactly (and uniquely, unless replace_all is set).

import { isAbsolute, resolve } from "node:path";
import { checkReadBeforeWrite, recordRead } from "./read-guard.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";
import { validateInput } from "./validate-input.ts";

function resolvePath(filePath: string, cwd: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export const editTool: Tool = Object.freeze<Tool>({
  name: "Edit",
  description:
    "Replace an exact string match in a file. Fails if old_string is missing, or " +
    "matches more than once without replace_all.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      replace_all: { type: "boolean" },
    },
    required: ["file_path", "old_string", "new_string"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    // Scoped to file_path/old_string/new_string only — 'replace_all' has no error path of its
    // own (it's just read as `=== true`), so running the shared validator over the whole
    // schema would risk pre-empting that with a spurious "must be a boolean" error.
    const validation = validateInput(
      {
        type: "object",
        properties: {
          file_path: editTool.inputSchema.properties.file_path,
          old_string: editTool.inputSchema.properties.old_string,
          new_string: editTool.inputSchema.properties.new_string,
        },
        required: ["file_path", "old_string", "new_string"],
      },
      "Edit",
      input,
    );
    if (!validation.ok) return validation.result;
    const filePath = input.file_path as string;
    const oldString = input.old_string as string;
    const newString = input.new_string as string;
    if (oldString === newString) {
      return {
        output: "Edit tool error: 'old_string' and 'new_string' must differ.",
        isError: true,
      };
    }
    const replaceAll = input.replace_all === true;

    const absPath = resolvePath(filePath, ctx.cwd);
    const file = Bun.file(absPath);
    if (!(await file.exists())) {
      return { output: `Edit tool error: file does not exist: ${absPath}`, isError: true };
    }

    const guardError = await checkReadBeforeWrite(ctx, absPath, "Edit");
    if (guardError) {
      return { output: guardError.error, isError: true };
    }

    const original = await file.text();
    const occurrences = countOccurrences(original, oldString);
    if (occurrences === 0) {
      return { output: `Edit tool error: old_string not found in ${absPath}`, isError: true };
    }
    if (occurrences > 1 && !replaceAll) {
      return {
        output: `Edit tool error: old_string is not unique in ${absPath} (${occurrences} matches); pass replace_all or a more specific old_string.`,
        isError: true,
      };
    }

    const updated = replaceAll
      ? original.split(oldString).join(newString)
      : original.replace(oldString, newString);

    await Bun.write(absPath, updated);
    await recordRead(ctx, absPath);

    return {
      output: `Updated ${absPath} (${occurrences} replacement${occurrences === 1 ? "" : "s"}).`,
      isError: false,
    };
  },
});
