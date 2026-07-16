import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashTool } from "./bash.ts";
import { makeToolContext } from "./test-helpers.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dh-bash-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Bash tool", () => {
  test("runs a foreground command and returns its output", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await bashTool.execute(
      { command: "echo hello-world", run_in_background: false },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("hello-world");
  });

  test("runs against the real filesystem (writes a file, then reads it back via cat)", async () => {
    const ctx = makeToolContext({ cwd: dir });
    await bashTool.execute({ command: "echo content > file.txt", run_in_background: false }, ctx);
    const result = await bashTool.execute(
      { command: "cat file.txt", run_in_background: false },
      ctx,
    );
    expect(result.output.trim()).toBe("content");
  });

  test("reports non-zero exit codes as errors", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await bashTool.execute({ command: "exit 3", run_in_background: false }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("exited with code 3");
  });

  test("captures stderr output too", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await bashTool.execute(
      { command: "echo oops 1>&2", run_in_background: false },
      ctx,
    );
    expect(result.output).toContain("oops");
  });

  test("run_in_background true (default) returns immediately with a task id, then TaskOutput observes it", async () => {
    const ctx = makeToolContext({ cwd: dir, runInBackgroundDefault: true });
    const started = await bashTool.execute({ command: "echo bg-output" }, ctx);
    expect(started.isError).toBe(false);
    expect(started.output).toMatch(/Started background task bash-\d+/);
    const taskId = started.output.match(/bash-\d+/)?.[0];
    if (!taskId) throw new Error("expected a task id in the output");
    await ctx.tasks.awaitDone(taskId);
    const snapshot = ctx.tasks.snapshot(taskId);
    expect(snapshot.status).toBe("done");
    expect(snapshot.output).toContain("bg-output");
  });

  test("runInBackgroundDefault false runs in the foreground without an explicit flag", async () => {
    const ctx = makeToolContext({ cwd: dir, runInBackgroundDefault: false });
    const result = await bashTool.execute({ command: "echo fg" }, ctx);
    expect(result.output.trim()).toBe("fg");
  });

  test("rejects a missing command", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await bashTool.execute({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("command");
  });

  test("rejects an empty command string", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await bashTool.execute({ command: "" }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects a non-positive timeout_ms", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await bashTool.execute({ command: "echo hi", timeout_ms: -5 }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("timeout");
  });

  test("rejects a non-number timeout_ms", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await bashTool.execute({ command: "echo hi", timeout_ms: "soon" }, ctx);
    expect(result.isError).toBe(true);
  });

  test("times out long-running commands and marks the task failed", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await bashTool.execute(
      { command: "sleep 5", timeout_ms: 50, run_in_background: false },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("timed out");
  }, 2000);

  test("DH-0011: a timed-out command's backgrounded grandchild is reaped too, not left orphaned", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const markerFile = join(dir, "grandchild-alive");
    // The outer command backgrounds a long sleep (a grandchild from the tool's perspective)
    // and returns immediately; before DH-0011, killing only the immediate `bash -c` process
    // left that backgrounded sleep running as an orphan.
    await bashTool.execute(
      {
        command: `(touch ${markerFile}; sleep 30; rm -f ${markerFile}) & disown; sleep 5`,
        timeout: 100,
        run_in_background: false,
      },
      ctx,
    );
    // Give the backgrounded process a moment to have started (touch the marker) before we
    // check whether the process-group kill reaped it.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const stillRunning = await new Promise<boolean>((resolve) => {
      const check = Bun.spawn(["pgrep", "-f", `touch ${markerFile}`], { stdout: "ignore" });
      check.exited.then((code) => resolve(code === 0));
    });
    expect(stillRunning).toBe(false);
  }, 3000);

  test("clamps timeout_ms to the maximum allowed", async () => {
    const ctx = makeToolContext({ cwd: dir });
    const result = await bashTool.execute(
      { command: "echo capped", timeout_ms: 10_000_000, run_in_background: false },
      ctx,
    );
    expect(result.output.trim()).toBe("capped");
  });

  describe("Round 13 conformance", () => {
    test("honors the real 'timeout' param name (not just the 'timeout_ms' alias)", async () => {
      const ctx = makeToolContext({ cwd: dir });
      const start = Date.now();
      const result = await bashTool.execute(
        { command: "sleep 5", timeout: 50, run_in_background: false },
        ctx,
      );
      const elapsed = Date.now() - start;
      expect(result.isError).toBe(true);
      expect(result.output).toContain("timed out after 50ms");
      expect(elapsed).toBeLessThan(2000);
    }, 3000);

    test("'timeout' takes precedence over 'timeout_ms' when both are given", async () => {
      const ctx = makeToolContext({ cwd: dir });
      const result = await bashTool.execute(
        { command: "sleep 5", timeout: 50, timeout_ms: 10_000, run_in_background: false },
        ctx,
      );
      expect(result.isError).toBe(true);
      expect(result.output).toContain("timed out after 50ms");
    }, 3000);

    test("DH-0080: caps returned output with a head+tail preview and saves the full output to a file", async () => {
      const ctx = makeToolContext({ cwd: dir });
      // Produce well over the 30,000-char cap.
      const result = await bashTool.execute(
        {
          command: "yes x | head -c 40000",
          run_in_background: false,
        },
        ctx,
      );
      expect(result.isError).toBe(false);
      expect(result.output).toContain("Output too large (40000 chars)");
      expect(result.output).toContain("Full output saved to:");
      expect(result.output).toContain("Preview (first 2000 chars)");
      expect(result.output).toContain("Tail preview (last 2000 chars)");

      const pathMatch = result.output.match(/Full output saved to: (\S+)/);
      expect(pathMatch).not.toBeNull();
      const savedPath = pathMatch?.[1] ?? "";
      const saved = await Bun.file(savedPath).text();
      expect(saved.length).toBe(40000);
      expect(saved.replace(/\n/g, "")).toBe("x".repeat(saved.replace(/\n/g, "").length));
    });

    test("working directory does NOT persist between calls (documented statelessness)", async () => {
      const ctx = makeToolContext({ cwd: dir });
      await bashTool.execute(
        {
          command: `cd ${dir}/does-not-exist-marker-dir || true; mkdir -p sub && cd sub`,
          run_in_background: false,
        },
        ctx,
      );
      const result = await bashTool.execute({ command: "pwd", run_in_background: false }, ctx);
      // Every call runs fresh at ctx.cwd — the prior call's `cd sub` must not have persisted.
      // Compare via realpath since bash's `pwd` resolves symlinks (e.g. macOS's /var ->
      // /private/var) that mkdtemp's returned path may not have been resolved through.
      expect(await realpath(result.output.trim())).toBe(await realpath(dir));
    });

    test("tool description documents the cwd-reset/statelessness divergence from a real shell", () => {
      expect(bashTool.description).toContain("do NOT persist between calls");
    });
  });
});
