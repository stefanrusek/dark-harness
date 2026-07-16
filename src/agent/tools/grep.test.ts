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

  describe("context lines (-A/-B/-C)", () => {
    test("-C shows N lines of context before and after, with -- between groups", async () => {
      await Bun.write(
        join(dir, "a.txt"),
        ["l1", "l2", "match-one", "l4", "l5", "l6", "l7", "match-two", "l9"].join("\n"),
      );
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute(
        { pattern: "match", output_mode: "content", "-C": 1 },
        ctx,
      );
      expect(result.output).toBe(
        [
          "a.txt-l2",
          "a.txt:match-one",
          "a.txt-l4",
          "--",
          "a.txt-l7",
          "a.txt:match-two",
          "a.txt-l9",
        ].join("\n"),
      );
    });

    test("-A and -B apply independently in each direction", async () => {
      await Bun.write(join(dir, "a.txt"), ["l1", "l2", "match", "l4", "l5"].join("\n"));
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute(
        { pattern: "match", output_mode: "content", "-A": 2, "-B": 1 },
        ctx,
      );
      expect(result.output).toBe(["a.txt-l2", "a.txt:match", "a.txt-l4", "a.txt-l5"].join("\n"));
    });

    test("context clamps at file boundaries", async () => {
      await Bun.write(join(dir, "a.txt"), ["match", "l2"].join("\n"));
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute(
        { pattern: "match", output_mode: "content", "-C": 5 },
        ctx,
      );
      expect(result.output).toBe(["a.txt:match", "a.txt-l2"].join("\n"));
    });

    test("context lines include line numbers when -n is set", async () => {
      await Bun.write(join(dir, "a.txt"), ["l1", "match", "l3"].join("\n"));
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute(
        { pattern: "match", output_mode: "content", "-C": 1, "-n": true },
        ctx,
      );
      expect(result.output).toBe(["a.txt-1-l1", "a.txt:2:match", "a.txt-3-l3"].join("\n"));
    });

    test("rejects -A/-B/-C outside 'content' output_mode", async () => {
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute({ pattern: "x", "-C": 2 }, ctx);
      expect(result.isError).toBe(true);
      expect(result.output).toContain("only apply when output_mode is 'content'");
    });

    test("rejects a negative context value", async () => {
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute(
        { pattern: "x", output_mode: "content", "-A": -1 },
        ctx,
      );
      expect(result.isError).toBe(true);
      expect(result.output).toContain("-A");
    });

    test("rejects a non-integer context value", async () => {
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute(
        { pattern: "x", output_mode: "content", "-B": 1.5 },
        ctx,
      );
      expect(result.isError).toBe(true);
      expect(result.output).toContain("-B");
    });
  });

  describe("multiline mode", () => {
    test("matches a pattern that spans multiple lines when multiline is true", async () => {
      await Bun.write(join(dir, "a.txt"), "import {\n  X\n} from 'y';\nother line");
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute(
        { pattern: "import \\{.*\\} from", multiline: true },
        ctx,
      );
      expect(result.isError).toBe(false);
      expect(result.output).toContain("a.txt");
    });

    test("does not match a cross-line pattern when multiline is false", async () => {
      await Bun.write(join(dir, "a.txt"), "import {\n  X\n} from 'y';");
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute({ pattern: "import \\{.*\\} from" }, ctx);
      expect(result.output).toBe("No matches found.");
    });

    test("multiline content mode reports every line the match spans", async () => {
      await Bun.write(join(dir, "a.txt"), "start\nfoo\nbar\nend");
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute(
        { pattern: "foo\\nbar", output_mode: "content", multiline: true, "-n": true },
        ctx,
      );
      expect(result.output).toBe(["a.txt:2:foo", "a.txt:3:bar"].join("\n"));
    });

    test("multiline count reflects distinct matches, not matched lines", async () => {
      await Bun.write(join(dir, "a.txt"), "aXb\naXb");
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute(
        { pattern: "a.b", output_mode: "count", multiline: true },
        ctx,
      );
      expect(result.output).toBe("a.txt:2");
    });

    test("rejects a non-boolean multiline value", async () => {
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute({ pattern: "x", multiline: "yes" }, ctx);
      expect(result.isError).toBe(true);
      expect(result.output).toContain("multiline");
    });
  });

  describe("type filter", () => {
    test("searches only files matching the given type", async () => {
      await Bun.write(join(dir, "a.ts"), "needle");
      await Bun.write(join(dir, "a.py"), "needle");
      await Bun.write(join(dir, "a.md"), "needle");
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute({ pattern: "needle", type: "ts" }, ctx);
      expect(result.output).toContain("a.ts");
      expect(result.output).not.toContain("a.py");
      expect(result.output).not.toContain("a.md");
    });

    test("combines with an explicit glob", async () => {
      await mkdir(join(dir, "sub"), { recursive: true });
      await Bun.write(join(dir, "a.ts"), "needle");
      await Bun.write(join(dir, "sub", "b.ts"), "needle");
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute({ pattern: "needle", type: "ts", glob: "*.ts" }, ctx);
      expect(result.output).toContain("a.ts");
      expect(result.output).not.toContain("b.ts");
    });

    test("rejects an unknown type", async () => {
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute({ pattern: "x", type: "cobol" }, ctx);
      expect(result.isError).toBe(true);
      expect(result.output).toContain("unknown 'type'");
    });

    test("rejects a non-string type", async () => {
      const ctx = makeToolContext({ cwd: dir });
      const result = await grepTool.execute({ pattern: "x", type: 5 }, ctx);
      expect(result.isError).toBe(true);
    });
  });
});
