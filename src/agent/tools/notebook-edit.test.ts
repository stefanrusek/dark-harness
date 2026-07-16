import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notebookEditTool } from "./notebook-edit.ts";
import { readTool } from "./read.ts";
import { makeToolContext } from "./test-helpers.ts";
import type { ToolContext } from "./types.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dh-notebook-edit-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function markRead(ctx: ToolContext, path: string): Promise<void> {
  await readTool.execute({ file_path: path }, ctx);
}

function makeNotebook(cells: unknown[]): string {
  return JSON.stringify({ cells, nbformat: 4, nbformat_minor: 5 });
}

describe("NotebookEdit tool", () => {
  test("replaces a cell's source by index", async () => {
    const path = join(dir, "nb.ipynb");
    await Bun.write(
      path,
      makeNotebook([
        {
          cell_type: "code",
          source: "x = 1",
          outputs: [{ output_type: "stream", text: "1" }],
          execution_count: 3,
        },
      ]),
    );
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, path);

    const result = await notebookEditTool.execute(
      { file_path: path, cell_index: 0, new_source: "x = 2" },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("Updated cell 0");

    const updated = JSON.parse(await Bun.file(path).text());
    expect(updated.cells[0].source).toBe("x = 2");
    expect(updated.cells[0].outputs).toEqual([]);
    expect(updated.cells[0].execution_count).toBeNull();
  });

  test("replaces a cell's source by id", async () => {
    const path = join(dir, "nb.ipynb");
    await Bun.write(
      path,
      makeNotebook([
        { cell_type: "markdown", source: "old", id: "abc" },
        { cell_type: "markdown", source: "other", id: "def" },
      ]),
    );
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, path);

    const result = await notebookEditTool.execute(
      { file_path: path, cell_id: "abc", new_source: "new content" },
      ctx,
    );
    expect(result.isError).toBe(false);

    const updated = JSON.parse(await Bun.file(path).text());
    expect(updated.cells[0].source).toBe("new content");
    expect(updated.cells[1].source).toBe("other");
  });

  test("optionally changes cell_type", async () => {
    const path = join(dir, "nb.ipynb");
    await Bun.write(path, makeNotebook([{ cell_type: "code", source: "x = 1" }]));
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, path);

    const result = await notebookEditTool.execute(
      { file_path: path, cell_index: 0, new_source: "# heading", cell_type: "markdown" },
      ctx,
    );
    expect(result.isError).toBe(false);

    const updated = JSON.parse(await Bun.file(path).text());
    expect(updated.cells[0].cell_type).toBe("markdown");
    expect(updated.cells[0].source).toBe("# heading");
  });

  test("errors when neither cell_index nor cell_id is provided", async () => {
    const path = join(dir, "nb.ipynb");
    await Bun.write(path, makeNotebook([{ cell_type: "code", source: "x = 1" }]));
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, path);

    const result = await notebookEditTool.execute({ file_path: path, new_source: "y = 2" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("cell_index");
  });

  test("errors when cell_id is not found", async () => {
    const path = join(dir, "nb.ipynb");
    await Bun.write(path, makeNotebook([{ cell_type: "code", source: "x = 1", id: "a" }]));
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, path);

    const result = await notebookEditTool.execute(
      { file_path: path, cell_id: "zzz", new_source: "y = 2" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("no cell with id 'zzz'");
  });

  test("errors when cell_index is out of range", async () => {
    const path = join(dir, "nb.ipynb");
    await Bun.write(path, makeNotebook([{ cell_type: "code", source: "x = 1" }]));
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, path);

    const result = await notebookEditTool.execute(
      { file_path: path, cell_index: 5, new_source: "y = 2" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("out of range");
  });

  test("rejects a missing file_path", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await notebookEditTool.execute({ new_source: "x" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("file_path");
  });

  test("rejects a missing new_source", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await notebookEditTool.execute({ file_path: join(dir, "a.ipynb") }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("new_source");
  });

  test("rejects a non-number cell_index", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await notebookEditTool.execute(
      { file_path: join(dir, "a.ipynb"), cell_index: "0", new_source: "x" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("cell_index");
  });

  test("rejects a non-string cell_id", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await notebookEditTool.execute(
      { file_path: join(dir, "a.ipynb"), cell_id: 5, new_source: "x" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("cell_id");
  });

  test("rejects an invalid cell_type", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await notebookEditTool.execute(
      { file_path: join(dir, "a.ipynb"), cell_index: 0, new_source: "x", cell_type: "bogus" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("cell_type");
  });

  test("rejects a non-.ipynb file_path", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await notebookEditTool.execute(
      { file_path: join(dir, "a.txt"), cell_index: 0, new_source: "x" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not a .ipynb file");
  });

  test("errors when the file does not exist", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await notebookEditTool.execute(
      { file_path: join(dir, "nope.ipynb"), cell_index: 0, new_source: "x" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("does not exist");
  });

  test("enforces the read-before-write guard", async () => {
    const path = join(dir, "nb.ipynb");
    await Bun.write(path, makeNotebook([{ cell_type: "code", source: "x = 1" }]));
    const ctx = makeToolContext({ cwd: dir });
    const result = await notebookEditTool.execute(
      { file_path: path, cell_index: 0, new_source: "x = 2" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("has not been Read");
  });

  test("errors on invalid JSON", async () => {
    const path = join(dir, "bad.ipynb");
    await Bun.write(path, "{ not json");
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, path);
    const result = await notebookEditTool.execute(
      { file_path: path, cell_index: 0, new_source: "x" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not valid JSON");
  });

  test("errors when the file lacks a cells array", async () => {
    const path = join(dir, "notreally.ipynb");
    await Bun.write(path, JSON.stringify({ nbformat: 4 }));
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, path);
    const result = await notebookEditTool.execute(
      { file_path: path, cell_index: 0, new_source: "x" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("does not look like a notebook");
  });
});
