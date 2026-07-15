import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTool } from "./read.ts";
import { makeToolContext } from "./test-helpers.ts";
import type { ToolContext } from "./types.ts";
import { writeTool } from "./write.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dh-write-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function markRead(ctx: ToolContext, path: string): Promise<void> {
  await readTool.execute({ file_path: path }, ctx);
}

describe("Write tool", () => {
  test("creates a new file with the given content", async () => {
    const path = join(dir, "new.txt");
    const ctx = makeToolContext({ cwd: dir });
    const result = await writeTool.execute({ file_path: path, content: "hello" }, ctx);
    expect(result.isError).toBe(false);
    expect(await Bun.file(path).text()).toBe("hello");
  });

  test("overwrites an existing file that was Read first", async () => {
    const path = join(dir, "existing.txt");
    await Bun.write(path, "old");
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, path);
    const result = await writeTool.execute({ file_path: path, content: "new" }, ctx);
    expect(result.isError).toBe(false);
    expect(await Bun.file(path).text()).toBe("new");
  });

  test("creates parent directories as needed", async () => {
    const path = join(dir, "nested", "deep", "file.txt");
    const ctx = makeToolContext({ cwd: dir });
    const result = await writeTool.execute({ file_path: path, content: "deep" }, ctx);
    expect(result.isError).toBe(false);
    expect(await Bun.file(path).text()).toBe("deep");
  });

  test("resolves relative paths against ctx.cwd", async () => {
    const ctx = makeToolContext({ cwd: dir });
    await writeTool.execute({ file_path: "rel.txt", content: "rel" }, ctx);
    expect(await Bun.file(join(dir, "rel.txt")).text()).toBe("rel");
  });

  test("rejects a missing file_path", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await writeTool.execute({ content: "x" }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects a non-string content", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await writeTool.execute({ file_path: join(dir, "x.txt"), content: 5 }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("content");
  });

  test("reports a write failure (target path is an existing directory)", async () => {
    const dirAsFile = join(dir, "im-a-dir");
    await Bun.$`mkdir -p ${dirAsFile}`.quiet();
    const ctx = makeToolContext({ cwd: dir });
    const result = await writeTool.execute({ file_path: dirAsFile, content: "x" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("failed to write");
  });

  describe("read-before-write guard (Round 13)", () => {
    test("refuses to overwrite an existing unread path", async () => {
      const path = join(dir, "unread.txt");
      await Bun.write(path, "old");
      const ctx = makeToolContext({ cwd: dir });
      const result = await writeTool.execute({ file_path: path, content: "new" }, ctx);
      expect(result.isError).toBe(true);
      expect(result.output).toContain("has not been Read");
      expect(await Bun.file(path).text()).toBe("old");
    });

    test("writing a brand-new path succeeds without any prior Read", async () => {
      const path = join(dir, "brand-new.txt");
      const ctx = makeToolContext({ cwd: dir });
      const result = await writeTool.execute({ file_path: path, content: "fresh" }, ctx);
      expect(result.isError).toBe(false);
      expect(await Bun.file(path).text()).toBe("fresh");
    });
  });
});
