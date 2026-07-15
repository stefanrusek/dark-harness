import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grepTool } from "./grep.ts";
import { makeToolContext } from "./test-helpers.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dh-grep-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Grep tool", () => {
  test("files_with_matches (default) lists matching file paths", async () => {
    await Bun.write(join(dir, "a.txt"), "hello world\nfoo bar");
    await Bun.write(join(dir, "b.txt"), "nothing relevant");
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "hello" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("a.txt");
    expect(result.output).not.toContain("b.txt");
  });

  test("content mode returns matching lines with optional line numbers", async () => {
    await Bun.write(join(dir, "a.txt"), "line one\nmatch here\nline three");
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute(
      { pattern: "match", output_mode: "content", "-n": true },
      ctx,
    );
    expect(result.output).toContain("a.txt:2:match here");
  });

  test("content mode without -n omits the line number", async () => {
    await Bun.write(join(dir, "a.txt"), "match here");
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "match", output_mode: "content" }, ctx);
    expect(result.output).toBe("a.txt:match here");
  });

  test("count mode returns per-file match counts", async () => {
    await Bun.write(join(dir, "a.txt"), "x\nx\ny");
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "x", output_mode: "count" }, ctx);
    expect(result.output).toBe("a.txt:2");
  });

  test("case-insensitive matching via -i", async () => {
    await Bun.write(join(dir, "a.txt"), "HELLO");
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "hello", "-i": true }, ctx);
    expect(result.output).toContain("a.txt");
  });

  test("respects the 'glob' filter", async () => {
    await Bun.write(join(dir, "a.ts"), "needle");
    await Bun.write(join(dir, "a.md"), "needle");
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "needle", glob: "*.ts" }, ctx);
    expect(result.output).toContain("a.ts");
    expect(result.output).not.toContain("a.md");
  });

  test("searches a single file directly when 'path' is a file", async () => {
    await mkdir(join(dir, "sub"), { recursive: true });
    await Bun.write(join(dir, "sub", "only.txt"), "needle here");
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute(
      { pattern: "needle", path: join(dir, "sub", "only.txt") },
      ctx,
    );
    expect(result.output).toContain(join(dir, "sub", "only.txt"));
    expect(result.isError).toBe(false);
  });

  test("skips binary files instead of erroring or returning garbage", async () => {
    await Bun.write(
      join(dir, "bin.dat"),
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]),
    );
    await Bun.write(join(dir, "text.txt"), "needle");
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "needle" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("text.txt");
    expect(result.output).not.toContain("bin.dat");
  });

  test("reports no matches distinctly", async () => {
    await Bun.write(join(dir, "a.txt"), "nothing");
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "zzz_no_match" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toBe("No matches found.");
  });

  test("truncates results past head_limit with a clear notice", async () => {
    for (let i = 0; i < 5; i++) {
      await Bun.write(join(dir, `f${i}.txt`), "needle");
    }
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "needle", head_limit: 2 }, ctx);
    expect(result.output).toContain("Results truncated: showing 2 of 5 total");
  });

  test("rejects a missing pattern", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("pattern");
  });

  test("rejects an invalid regular expression", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "(unterminated" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("invalid regular expression");
  });

  test("rejects an invalid output_mode", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "x", output_mode: "bogus" }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects a non-string path", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "x", path: 5 }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects a non-string glob", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "x", glob: 5 }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects a non-positive head_limit", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "x", head_limit: 0 }, ctx);
    expect(result.isError).toBe(true);
  });

  test("errors when 'path' does not exist", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "x", path: "nope" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("does not exist");
  });

  test("skips node_modules directories", async () => {
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await Bun.write(join(dir, "node_modules", "pkg", "index.js"), "needle");
    await Bun.write(join(dir, "real.txt"), "needle");
    const ctx = makeToolContext({ cwd: dir });
    const result = await grepTool.execute({ pattern: "needle" }, ctx);
    expect(result.output).toContain("real.txt");
    expect(result.output).not.toContain("node_modules");
  });
});
