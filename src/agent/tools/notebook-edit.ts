// NotebookEdit tool — structured cell-level edit for Jupyter notebooks (DH-0073). Mirrors real
// Claude Code's decision to keep NotebookEdit as a separate tool from Edit rather than a
// merged/notebook-aware Edit mode: targeting a cell by index/id and replacing its `source`
// directly avoids the fragility of an old_string/new_string match against raw JSON (whitespace
// and string-escaping inside a notebook's JSON make exact-match editing error-prone).
//
// Follows the same read-before-write guard convention as Edit/Write (read-guard.ts): a cell
// edit requires the notebook to have been Read first, same discipline as any other in-place
// file mutation.

import { isAbsolute, resolve } from "node:path";
import type { NotebookCell, NotebookJson } from "./read.ts";
import { checkReadBeforeWrite, recordRead } from "./read-guard.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";

function resolvePath(filePath: string, cwd: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

function findCellIndex(
  notebook: NotebookJson,
  cellId: string | undefined,
  cellIndex: number | undefined,
): number | { error: string } {
  if (cellId !== undefined) {
    const index = notebook.cells.findIndex((cell) => cell.id === cellId);
    if (index === -1) {
      return { error: `no cell with id '${cellId}' found` };
    }
    return index;
  }
  if (cellIndex !== undefined) {
    if (cellIndex < 0 || cellIndex >= notebook.cells.length) {
      return {
        error: `cell_index ${cellIndex} is out of range (notebook has ${notebook.cells.length} cells)`,
      };
    }
    return cellIndex;
  }
  return { error: "either 'cell_index' or 'cell_id' must be provided" };
}

export const notebookEditTool: Tool = Object.freeze<Tool>({
  name: "NotebookEdit",
  description:
    "Replace a Jupyter notebook cell's source directly by cell index or id — a structured " +
    "alternative to Edit for .ipynb files, which are fragile to exact-string-match editing.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Absolute or cwd-relative path to the .ipynb file.",
      },
      cell_index: { type: "number", description: "0-based index of the cell to edit." },
      cell_id: {
        type: "string",
        description: "id of the cell to edit (alternative to cell_index).",
      },
      new_source: { type: "string", description: "New source content for the cell." },
      cell_type: {
        type: "string",
        description: "Optional: change the cell's type ('code', 'markdown', or 'raw').",
      },
    },
    required: ["file_path", "new_source"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const filePath = input.file_path;
    const newSource = input.new_source;
    const cellIndexInput = input.cell_index;
    const cellId = input.cell_id;
    const cellType = input.cell_type;

    if (typeof filePath !== "string" || filePath.length === 0) {
      return {
        output: "NotebookEdit tool error: 'file_path' must be a non-empty string.",
        isError: true,
      };
    }
    if (typeof newSource !== "string") {
      return { output: "NotebookEdit tool error: 'new_source' must be a string.", isError: true };
    }
    if (cellIndexInput !== undefined && typeof cellIndexInput !== "number") {
      return { output: "NotebookEdit tool error: 'cell_index' must be a number.", isError: true };
    }
    if (cellId !== undefined && typeof cellId !== "string") {
      return { output: "NotebookEdit tool error: 'cell_id' must be a string.", isError: true };
    }
    if (
      cellType !== undefined &&
      (typeof cellType !== "string" || !["code", "markdown", "raw"].includes(cellType))
    ) {
      return {
        output: "NotebookEdit tool error: 'cell_type' must be one of 'code', 'markdown', 'raw'.",
        isError: true,
      };
    }
    if (!filePath.toLowerCase().endsWith(".ipynb")) {
      return {
        output: `NotebookEdit tool error: ${filePath} is not a .ipynb file.`,
        isError: true,
      };
    }

    const absPath = resolvePath(filePath, ctx.cwd);
    const file = Bun.file(absPath);
    if (!(await file.exists())) {
      return { output: `NotebookEdit tool error: file does not exist: ${absPath}`, isError: true };
    }

    const guardError = await checkReadBeforeWrite(ctx, absPath, "NotebookEdit");
    if (guardError) {
      return { output: guardError.error, isError: true };
    }

    let notebook: NotebookJson;
    try {
      notebook = JSON.parse(await file.text()) as NotebookJson;
    } catch (err) {
      return {
        output: `NotebookEdit tool error: ${absPath} is not valid JSON: ${(err as Error).message}`,
        isError: true,
      };
    }
    if (!notebook || !Array.isArray(notebook.cells)) {
      return {
        output: `NotebookEdit tool error: ${absPath} does not look like a notebook (missing a 'cells' array).`,
        isError: true,
      };
    }

    const resolved = findCellIndex(notebook, cellId, cellIndexInput);
    if (typeof resolved !== "number") {
      return { output: `NotebookEdit tool error: ${resolved.error}`, isError: true };
    }

    const cell = notebook.cells[resolved] as NotebookCell;
    cell.source = newSource;
    if (cellType !== undefined) {
      cell.cell_type = cellType;
    }
    // Editing a code cell's source invalidates its prior execution result — clear stale
    // outputs/execution_count so a re-read doesn't show output that no longer matches the code.
    if (cell.cell_type === "code") {
      cell.outputs = [];
      cell.execution_count = null;
    }

    await Bun.write(absPath, JSON.stringify(notebook, null, 1));
    await recordRead(ctx, absPath);

    return {
      output: `Updated cell ${resolved} in ${absPath}.`,
      isError: false,
    };
  },
});
