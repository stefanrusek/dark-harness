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

  test("reports empty files distinctly, matching real Claude Code's wording", async () => {
    const path = join(dir, "empty.txt");
    await Bun.write(path, "");
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toBe(
      "<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>",
    );
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

  test("DH-0079: a small file with more than 2000 lines is read in full with no truncation, matching real Claude Code", async () => {
    const path = join(dir, "big.txt");
    const totalLines = 2500;
    await Bun.write(path, Array.from({ length: totalLines }, (_, i) => `L${i + 1}`).join("\n"));
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).not.toContain("truncated");
    const bodyLines = result.output.split("\n");
    expect(bodyLines).toHaveLength(2500);
    expect(bodyLines[0]).toBe("     1\tL1");
    expect(bodyLines[2499]).toBe("  2500\tL2500");
  });

  test("DH-0079: an explicit offset/limit still windows and truncates with a notice", async () => {
    const path = join(dir, "big2.txt");
    const totalLines = 2500;
    await Bun.write(path, Array.from({ length: totalLines }, (_, i) => `L${i + 1}`).join("\n"));
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path, limit: 2000 }, ctx);
    expect(result.isError).toBe(false);

    const parts = result.output.split("\n\n<system-reminder>");
    const body = parts[0] ?? "";
    const notice = parts[1] ?? "";
    const bodyLines = body.split("\n");
    expect(bodyLines).toHaveLength(2000);
    expect(notice).toContain("500 more lines not shown");
  });

  test("no truncation notice when the file fits within the default limit", async () => {
    const path = join(dir, "small.txt");
    await Bun.write(path, Array.from({ length: 5 }, (_, i) => `L${i + 1}`).join("\n"));
    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.output).not.toContain("truncated");
  });

  test("refuses a file above the absolute size ceiling without reading its content, even with offset/limit", async () => {
    const path = join(dir, "huge.txt");
    const bigSize = 256 * 1024 * 1024 + 1;
    // Sparse file: truncate to a size far past the 256MB ceiling without allocating real disk
    // or memory for its content — proves the cap check happens from metadata (file.size) alone.
    const handle = await open(path, "w");
    await handle.truncate(bigSize);
    await handle.close();

    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("exceeding");
    expect(result.output).toContain(`${bigSize} bytes`);

    // The absolute ceiling applies unconditionally — offset/limit doesn't bypass it.
    const windowed = await readTool.execute({ file_path: path, offset: 1, limit: 10 }, ctx);
    expect(windowed.isError).toBe(true);
    expect(windowed.output).toContain("exceeding");
  });

  test("DH-0079: reports a megabyte-scale file size in the primary-cap error using an MB unit", async () => {
    const path = join(dir, "midsize.txt");
    const midSize = 3 * 1024 * 1024; // 3MB — under the 256MB absolute ceiling, over the 256KB cap.
    // Sparse file: avoids allocating 3MB of real content just to exercise the size-formatting
    // branch for megabyte-scale sizes.
    const handle = await open(path, "w");
    await handle.truncate(midSize);
    await handle.close();

    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("3.0MB");
  });

  test("DH-0079: a whole-file read (no offset/limit) hard-errors past the 256KB primary cap", async () => {
    const path = join(dir, "oversized.txt");
    // A single giant line under the 256MB absolute ceiling but well past the 256KB whole-file
    // cap — exactly the pathological case DH-0079 flags: small line count, huge byte size.
    const bigContent = "x".repeat(300 * 1024);
    await Bun.write(path, bigContent);

    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("exceeds maximum allowed size");
    expect(result.output).toContain("256KB");
    expect(result.output).toContain("offset and limit");
  });

  test("DH-0079: supplying offset/limit bypasses the whole-file 256KB cap, paging through safely", async () => {
    const path = join(dir, "oversized2.txt");
    const lines = Array.from({ length: 5 }, (_, i) => `line${i}${"x".repeat(60 * 1024)}`);
    await Bun.write(path, lines.join("\n"));

    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path, offset: 1, limit: 1 }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("line0");
  });

  test("DH-0079: a file exactly at the 256KB primary cap boundary is read in full, not refused", async () => {
    const path = join(dir, "boundary.txt");
    // Exactly 256KB total, single line — the cap check is `>`, not `>=`, so this must succeed.
    await Bun.write(path, "x".repeat(256 * 1024));

    const ctx = makeToolContext({ cwd: dir });
    const result = await readTool.execute({ file_path: path }, ctx);
    expect(result.isError).toBe(false);
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

  describe(".ipynb notebooks (DH-0073)", () => {
    function makeNotebook(cells: unknown[]): string {
      return JSON.stringify({ cells, nbformat: 4, nbformat_minor: 5 });
    }

    test("renders code and markdown cells with their source", async () => {
      const path = join(dir, "nb.ipynb");
      await Bun.write(
        path,
        makeNotebook([
          { cell_type: "markdown", source: ["# Title\n", "Some text."], id: "md1" },
          { cell_type: "code", source: "print('hi')", id: "code1", outputs: [] },
        ]),
      );
      const ctx = makeToolContext({ cwd: dir });
      const result = await readTool.execute({ file_path: path }, ctx);
      expect(result.isError).toBe(false);
      expect(result.output).toContain("Cell 0 (markdown, id=md1)");
      expect(result.output).toContain("# Title\nSome text.");
      expect(result.output).toContain("Cell 1 (code, id=code1)");
      expect(result.output).toContain("print('hi')");
    });

    test("renders stream and execute_result text outputs", async () => {
      const path = join(dir, "nb.ipynb");
      await Bun.write(
        path,
        makeNotebook([
          {
            cell_type: "code",
            source: "print('hello')",
            outputs: [{ output_type: "stream", name: "stdout", text: ["hello\n"] }],
          },
          {
            cell_type: "code",
            source: "1 + 1",
            outputs: [{ output_type: "execute_result", data: { "text/plain": ["2"] } }],
          },
        ]),
      );
      const ctx = makeToolContext({ cwd: dir });
      const result = await readTool.execute({ file_path: path }, ctx);
      expect(result.isError).toBe(false);
      expect(result.output).toContain("Output:\nhello");
      expect(result.output).toContain("Output:\n2");
    });

    test("renders error outputs with traceback", async () => {
      const path = join(dir, "nb.ipynb");
      await Bun.write(
        path,
        makeNotebook([
          {
            cell_type: "code",
            source: "1/0",
            outputs: [
              {
                output_type: "error",
                ename: "ZeroDivisionError",
                evalue: "division by zero",
                traceback: ["Traceback...", "ZeroDivisionError: division by zero"],
              },
            ],
          },
        ]),
      );
      const ctx = makeToolContext({ cwd: dir });
      const result = await readTool.execute({ file_path: path }, ctx);
      expect(result.isError).toBe(false);
      expect(result.output).toContain("ZeroDivisionError: division by zero");
      expect(result.output).toContain("Traceback...");
    });

    test("renders image outputs as a placeholder, not raw base64", async () => {
      const path = join(dir, "nb.ipynb");
      const fakeBase64 = "QUJDRA=="; // "ABCD" - 8 chars -> 6 bytes decoded
      await Bun.write(
        path,
        makeNotebook([
          {
            cell_type: "code",
            source: "plt.show()",
            outputs: [{ output_type: "display_data", data: { "image/png": fakeBase64 } }],
          },
        ]),
      );
      const ctx = makeToolContext({ cwd: dir });
      const result = await readTool.execute({ file_path: path }, ctx);
      expect(result.isError).toBe(false);
      expect(result.output).toContain("[image output, 6 bytes, not yet displayable — see DH-0046]");
      expect(result.output).not.toContain(fakeBase64);
    });

    test("renders an output with no known renderable content", async () => {
      const path = join(dir, "nb.ipynb");
      await Bun.write(
        path,
        makeNotebook([
          {
            cell_type: "code",
            source: "weird()",
            outputs: [{ output_type: "display_data", data: {} }],
          },
        ]),
      );
      const ctx = makeToolContext({ cwd: dir });
      const result = await readTool.execute({ file_path: path }, ctx);
      expect(result.isError).toBe(false);
      expect(result.output).toContain("no renderable content");
    });

    test("cells with no outputs render without an Output section", async () => {
      const path = join(dir, "nb.ipynb");
      await Bun.write(path, makeNotebook([{ cell_type: "code", source: "x = 1" }]));
      const ctx = makeToolContext({ cwd: dir });
      const result = await readTool.execute({ file_path: path }, ctx);
      expect(result.isError).toBe(false);
      expect(result.output).not.toContain("Output:");
    });

    test("errors on invalid JSON in a .ipynb file", async () => {
      const path = join(dir, "bad.ipynb");
      await Bun.write(path, "{ not json");
      const ctx = makeToolContext({ cwd: dir });
      const result = await readTool.execute({ file_path: path }, ctx);
      expect(result.isError).toBe(true);
      expect(result.output).toContain("not valid JSON");
    });

    test("errors when a .ipynb file lacks a cells array", async () => {
      const path = join(dir, "notreally.ipynb");
      await Bun.write(path, JSON.stringify({ nbformat: 4 }));
      const ctx = makeToolContext({ cwd: dir });
      const result = await readTool.execute({ file_path: path }, ctx);
      expect(result.isError).toBe(true);
      expect(result.output).toContain("does not look like a notebook");
    });

    test("a .ipynb file larger than the 256KB whole-file cap is still rendered (notebooks bypass that cap)", async () => {
      const path = join(dir, "big.ipynb");
      const bigSource = "x".repeat(300 * 1024);
      await Bun.write(path, makeNotebook([{ cell_type: "code", source: bigSource }]));
      const ctx = makeToolContext({ cwd: dir });
      const result = await readTool.execute({ file_path: path }, ctx);
      expect(result.isError).toBe(false);
      expect(result.output).toContain(bigSource);
    });

    test("records the read for the read-before-write guard", async () => {
      const path = join(dir, "nb.ipynb");
      await Bun.write(path, makeNotebook([{ cell_type: "code", source: "x = 1" }]));
      const ctx = makeToolContext({ cwd: dir });
      await readTool.execute({ file_path: path }, ctx);
      expect(ctx.readRegistry.has(path)).toBe(true);
    });
  });
});
