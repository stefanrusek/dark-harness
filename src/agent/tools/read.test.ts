import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTool } from "./read.ts";
import { makeToolContext } from "./test-helpers.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dh-read-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Read tool", () => {
  test("reads a real file with cat -n style line numbers", async () => {
    const path = join(dir, "a.txt");
    await Bun.write(path, "line one\nline two\nline three");
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toBe("     1\tline one\n     2\tline two\n     3\tline three");
  });

  test("resolves relative paths against ctx.cwd", async () => {
    await Bun.write(join(dir, "rel.txt"), "hello");
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: "rel.txt" }, ctx);
    expect(result.output).toContain("hello");
  });

  test("honors offset and limit", async () => {
    const path = join(dir, "many.txt");
    await Bun.write(path, Array.from({ length: 10 }, (_, i) => `L${i + 1}`).join("\n"));
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path, offset: 3, limit: 2 }, ctx);
    expect(result.output).toBe("     3\tL3\n     4\tL4");
  });

  test("truncates very long lines", async () => {
    const path = join(dir, "long.txt");
    const longLine = "x".repeat(2500);
    await Bun.write(path, longLine);
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.output).toContain("...");
    expect(result.output.length).toBeLessThan(longLine.length);
  });

  test("reports empty files distinctly", async () => {
    const path = join(dir, "empty.txt");
    await Bun.write(path, "");
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("empty contents");
  });

  test("errors on a missing file", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: join(dir, "nope.txt") }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("does not exist");
  });

  test("rejects a missing file_path", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({}, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects an invalid offset", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: join(dir, "x.txt"), offset: 0 }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("offset");
  });

  test("rejects an invalid limit", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: join(dir, "x.txt"), limit: -1 }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("limit");
  });
});
