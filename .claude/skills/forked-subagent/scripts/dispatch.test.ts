import { describe, test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dispatch } from "./dispatch.ts";

// Integration tests: these spawn the real `claude` CLI as a real OS subprocess (no mocking —
// per CLAUDE.md §9, mocking child_process around a script whose entire job is spawning
// processes would test nothing meaningful). This costs a small amount of real API usage per
// run and is not part of `bun run test:coverage`'s src/ gate; run on demand via
// `bun test .claude/skills/forked-subagent`.

describe("dispatch (integration — real claude subprocess)", () => {
  test("launches claude with cwd set to the target directory and returns its final output", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dh0114-dispatch-"));

    const result = await dispatch({
      dir,
      prompt: "Reply with exactly and only this text, no other words: PONG",
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.dir).toBe(dir);
    expect(result.result).toContain("PONG");
    expect(result.sessionId).toBeTruthy();
  }, 60_000);

  test("the collected result is comparable to the Agent tool's contract — a plain text summary plus status", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dh0114-dispatch-"));

    const result = await dispatch({
      dir,
      prompt: "Create a file named marker.txt in the current directory containing the text: proof. Then reply with exactly: DONE",
    });

    expect(result.success).toBe(true);
    expect(await Bun.file(path.join(dir, "marker.txt")).text()).toContain("proof");
    expect(result.result).toContain("DONE");
  }, 60_000);
});
