import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, open, rm } from "node:fs/promises";
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
    expect(result.output).toContain("     3\tL3\n     4\tL4");
    // 10 lines total, offset 3 + limit 2 read through line 4 — 6 lines remain.
    expect(result.output).toContain("6 more lines not shown");
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

  test("a 2500-line file with no limit returns exactly 2000 numbered lines plus a truncation notice", async () => {
    const path = join(dir, "big.txt");
    const totalLines = 2500;
    await Bun.write(path, Array.from({ length: totalLines }, (_, i) => `L${i + 1}`).join("\n"));
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.isError).toBe(false);

    const parts = result.output.split("\n\n<system-reminder>");
    const body = parts[0] ?? "";
    const notice = parts[1] ?? "";
    const bodyLines = body.split("\n");
    expect(bodyLines).toHaveLength(2000);
    for (let i = 0; i < bodyLines.length; i++) {
      expect(bodyLines[i]).toBe(`${String(i + 1).padStart(6, " ")}\tL${i + 1}`);
    }
    expect(notice).toContain("500 more lines not shown");
  });

  test("no truncation notice when the file fits within the default limit", async () => {
    const path = join(dir, "small.txt");
    await Bun.write(path, Array.from({ length: 5 }, (_, i) => `L${i + 1}`).join("\n"));
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.output).not.toContain("truncated");
  });

  test("refuses a file above the size cap without reading its content", async () => {
    const path = join(dir, "huge.txt");
    const bigSize = 256 * 1024 * 1024 + 1;
    // Sparse file: truncate to a size far past the 256MB cap without allocating real disk or
    // memory for its content — proves the cap check happens from metadata (file.size) alone.
    const handle = await open(path, "w");
    await handle.truncate(bigSize);
    await handle.close();

    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("exceeding");
    expect(result.output).toContain(`${bigSize} bytes`);
  });

  test("refuses to decode a binary file, returning a clear error instead of garbage", async () => {
    const path = join(dir, "bin.dat");
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01,
    ]);
    await Bun.write(path, bytes);
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("binary file");
    expect(result.output).toContain(`${bytes.length} bytes`);
  });
});
