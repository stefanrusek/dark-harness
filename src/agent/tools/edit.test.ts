import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editTool } from "./edit.ts";
import { readTool } from "./read.ts";
import { makeToolContext } from "./test-helpers.ts";
import type { ToolContext } from "./types.type.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dh-edit-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Marks `path` as already-Read in `ctx` — most Edit tests are about replacement semantics,
 * not the read-before-write guard (which has its own dedicated tests below), so they seed the
 * registry directly via a real Read call rather than duplicating stat bookkeeping by hand. */
async function markRead(ctx: ToolContext, path: string): Promise<void> {
  await readTool.execute({ file_path: path }, ctx);
}

describe("Edit tool", () => {
  test("replaces a unique match", async () => {
    const path = join(dir, "a.txt");
    await Bun.write(path, "hello world");
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, path);
    const result = await editTool.execute(
      { file_path: path, old_string: "world", new_string: "there" },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(await Bun.file(path).text()).toBe("hello there");
  });

  test("resolves relative paths against ctx.cwd", async () => {
    await Bun.write(join(dir, "rel.txt"), "foo bar");
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, join(dir, "rel.txt"));
    await editTool.execute({ file_path: "rel.txt", old_string: "foo", new_string: "baz" }, ctx);
    expect(await Bun.file(join(dir, "rel.txt")).text()).toBe("baz bar");
  });

  test("errors when old_string is not found", async () => {
    const path = join(dir, "a.txt");
    await Bun.write(path, "hello world");
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, path);
    const result = await editTool.execute(
      { file_path: path, old_string: "missing", new_string: "x" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not found");
  });

  test("errors when old_string matches more than once without replace_all", async () => {
    const path = join(dir, "a.txt");
    await Bun.write(path, "foo foo foo");
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, path);
    const result = await editTool.execute(
      { file_path: path, old_string: "foo", new_string: "bar" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not unique");
  });

  test("replace_all replaces every match", async () => {
    const path = join(dir, "a.txt");
    await Bun.write(path, "foo foo foo");
    const ctx = makeToolContext({ cwd: dir });
    await markRead(ctx, path);
    const result = await editTool.execute(
      { file_path: path, old_string: "foo", new_string: "bar", replace_all: true },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(await Bun.file(path).text()).toBe("bar bar bar");
  });

  test("errors on a missing file", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await editTool.execute(
      { file_path: join(dir, "nope.txt"), old_string: "a", new_string: "b" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("does not exist");
  });

  test("rejects missing file_path", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await editTool.execute({ old_string: "a", new_string: "b" }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects non-string old_string", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await editTool.execute(
      { file_path: join(dir, "a.txt"), old_string: 1, new_string: "b" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("old_string");
  });

  test("rejects non-string new_string", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await editTool.execute(
      { file_path: join(dir, "a.txt"), old_string: "a", new_string: 1 },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("new_string");
  });

  test("rejects identical old_string and new_string", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await editTool.execute(
      { file_path: join(dir, "a.txt"), old_string: "a", new_string: "a" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("must differ");
  });

  describe("read-before-write guard (Round 13)", () => {
    test("refuses to Edit a file that was never Read in this context", async () => {
      const path = join(dir, "unread.txt");
      await Bun.write(path, "hello world");
      const ctx = makeToolContext({ cwd: dir });
      const result = await editTool.execute(
        { file_path: path, old_string: "world", new_string: "there" },
        ctx,
      );
      expect(result.isError).toBe(true);
      expect(result.output).toContain("has not been Read");
    });

    test("refuses to Edit a file that changed on disk since it was Read", async () => {
      const path = join(dir, "stale.txt");
      await Bun.write(path, "hello world");
      const ctx = makeToolContext({ cwd: dir });
      await markRead(ctx, path);

      // Simulate an external modification after the Read — bump mtime and change size/content.
      await Bun.write(path, "hello world, modified externally");
      const newStat = await stat(path);
      await utimes(path, newStat.atime, new Date(newStat.mtime.getTime() + 5000));

      const result = await editTool.execute(
        { file_path: path, old_string: "world", new_string: "there" },
        ctx,
      );
      expect(result.isError).toBe(true);
      expect(result.output).toContain("modified on disk since it was last Read");
    });

    test("a second Edit after a first Edit succeeds without re-Reading", async () => {
      const path = join(dir, "chain.txt");
      await Bun.write(path, "foo bar baz");
      const ctx = makeToolContext({ cwd: dir });
      await markRead(ctx, path);

      const first = await editTool.execute(
        { file_path: path, old_string: "foo", new_string: "FOO" },
        ctx,
      );
      expect(first.isError).toBe(false);

      const second = await editTool.execute(
        { file_path: path, old_string: "bar", new_string: "BAR" },
        ctx,
      );
      expect(second.isError).toBe(false);
      expect(await Bun.file(path).text()).toBe("FOO BAR baz");
    });
  });
});
