import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LogHeader, LogMessageEvent } from "../contracts/index.ts";
import { SessionLogger } from "./logger.ts";

describe("SessionLogger", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dh-server-logger-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("creates the log directory if it doesn't exist yet", () => {
    const nested = join(dir, "nested", "logs");
    const logger = new SessionLogger(nested);
    expect(logger.logDir).toBe(nested);
    // mkdirSync({recursive:true}) in the constructor must have created it already.
    const header: LogHeader = {
      type: "header",
      version: 1,
      sessionId: "s1",
      agentId: "a1",
      parentAgentId: null,
      spawnedAt: "2026-07-15T00:00:00.000Z",
      model: "sonnet",
      instructionsSummary: "do the thing",
    };
    logger.append("a1", header);
    expect(readFileSync(logger.filePathFor("a1"), "utf8")).toBe(`${JSON.stringify(header)}\n`);
  });

  test("appends header then events as successive JSON lines, one per line", () => {
    const logger = new SessionLogger(dir);
    const header: LogHeader = {
      type: "header",
      version: 1,
      sessionId: "s1",
      agentId: "a1",
      parentAgentId: null,
      spawnedAt: "2026-07-15T00:00:00.000Z",
      model: "sonnet",
      instructionsSummary: "do the thing",
    };
    const message: LogMessageEvent = {
      version: 1,
      timestamp: "2026-07-15T00:00:01.000Z",
      type: "message",
      role: "assistant",
      content: "hello",
    };
    logger.append("a1", header);
    logger.append("a1", message);

    const lines = readFileSync(logger.filePathFor("a1"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string)).toEqual(header);
    expect(JSON.parse(lines[1] as string)).toEqual(message);
  });

  test("writes each agent to its own file, keyed by agentId", () => {
    const logger = new SessionLogger(dir);
    const line: LogMessageEvent = {
      version: 1,
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "message",
      role: "user",
      content: "hi",
    };
    logger.append("agent-x", line);
    logger.append("agent-y", line);
    expect(logger.filePathFor("agent-x")).not.toBe(logger.filePathFor("agent-y"));
    expect(readFileSync(logger.filePathFor("agent-x"), "utf8")).toContain('"content":"hi"');
    expect(readFileSync(logger.filePathFor("agent-y"), "utf8")).toContain('"content":"hi"');
  });

  test("percent-encodes agentId into the filename so it can't escape logDir", () => {
    const logger = new SessionLogger(dir);
    const path = logger.filePathFor("../../etc/passwd");
    // The slashes are percent-encoded, so the whole id collapses into one filename
    // component directly inside logDir — it can never resolve outside of it, even though
    // the literal ".." characters remain (harmless once "/" is no longer a separator).
    expect(path).toBe(join(dir, "..%2F..%2Fetc%2Fpasswd.jsonl"));
    expect(path.startsWith(`${dir}/`)).toBe(true);
  });
});
