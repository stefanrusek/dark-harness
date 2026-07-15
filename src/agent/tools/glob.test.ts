import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globTool } from "./glob.ts";
import { makeToolContext } from "./test-helpers.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dh-glob-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Glob tool", () => {
  test("matches files by extension across nested directories", async () => {
    await Bun.write(join(dir, "a.ts"), "a");
    await mkdir(join(dir, "sub"), { recursive: true });
    await Bun.write(join(dir, "sub", "b.ts"), "b");
    await Bun.write(join(dir, "c.txt"), "c");
    const ctx = makeToolContext({ cwd: dir });
    const result = await globTool.execute({ pattern: "**/*.ts" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("a.ts");
    expect(result.output).toContain(join("sub", "b.ts"));
    expect(result.output).not.toContain("c.txt");
  });

  test("searches within an explicit 'path'", async () => {
    await mkdir(join(dir, "sub"), { recursive: true });
    await Bun.write(join(dir, "sub", "only.ts"), "x");
    await Bun.write(join(dir, "outside.ts"), "y");
    const ctx = makeToolContext({ cwd: dir });
    const result = await globTool.execute({ pattern: "*.ts", path: "sub" }, ctx);
    expect(result.output).toContain("only.ts");
    expect(result.output).not.toContain("outside.ts");
  });

  test("reports no matches distinctly", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await globTool.execute({ pattern: "*.nonexistent" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toBe("No files matched.");
  });

  test("sorts results by modification time, most recent first", async () => {
    await Bun.write(join(dir, "old.ts"), "old");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await Bun.write(join(dir, "new.ts"), "new");
    const ctx = makeToolContext({ cwd: dir });
    const result = await globTool.execute({ pattern: "*.ts" }, ctx);
    const lines = result.output.split("\n");
    expect(lines[0]).toContain("new.ts");
    expect(lines[1]).toContain("old.ts");
  });

  test("rejects a missing pattern", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await globTool.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("pattern");
  });

  test("rejects a non-string path", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await globTool.execute({ pattern: "*.ts", path: 5 }, ctx);
    expect(result.isError).toBe(true);
  });

  test("errors when 'path' does not exist", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await globTool.execute({ pattern: "*.ts", path: "nope" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("does not exist");
  });

  test("errors when 'path' is a file, not a directory", async () => {
    await Bun.write(join(dir, "file.txt"), "x");
    const ctx = makeToolContext({ cwd: dir });
    const result = await globTool.execute({ pattern: "*.ts", path: "file.txt" }, ctx);
    expect(result.isError).toBe(true);
  });
});
