import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  LogCompletedEvent,
  LogFailedEvent,
  LogHeader,
  LogMessageEvent,
  LogStatusChangeEvent,
  LogToolCallEvent,
} from "../contracts/index.ts";
import { SessionLogger } from "./logger.ts";

function baseHeader(overrides: Partial<LogHeader> = {}): LogHeader {
  return {
    type: "header",
    version: 1,
    sessionId: "s1",
    agentId: "a1",
    parentAgentId: null,
    spawnedAt: "2026-07-15T00:00:00.000Z",
    model: "sonnet",
    instructionsSummary: "do the thing",
    client: "none",
    build: { version: "0.0.0", gitSha: null, dirty: false, releaseTag: null },
    ...overrides,
  };
}

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
      client: "none",
      build: { version: "0.0.0", gitSha: null, dirty: false, releaseTag: null },
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
      client: "none",
      build: { version: "0.0.0", gitSha: null, dirty: false, releaseTag: null },
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

  test("fsyncs structurally critical lines (header, completed, failed, terminal status_change)", () => {
    const openSpy = spyOn(fs, "openSync");
    const writeSpy = spyOn(fs, "writeSync");
    const fsyncSpy = spyOn(fs, "fsyncSync");
    const closeSpy = spyOn(fs, "closeSync");
    const logger = new SessionLogger(dir);

    logger.append("a1", baseHeader());
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(fsyncSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);

    const completed: LogCompletedEvent = {
      version: 1,
      timestamp: "2026-07-15T00:00:01.000Z",
      type: "completed",
      success: true,
    };
    logger.append("a1", completed);
    expect(fsyncSpy).toHaveBeenCalledTimes(2);

    const failed: LogFailedEvent = {
      version: 1,
      timestamp: "2026-07-15T00:00:02.000Z",
      type: "failed",
      reason: "oops",
    };
    logger.append("a1", failed);
    expect(fsyncSpy).toHaveBeenCalledTimes(3);

    const terminalStatus: LogStatusChangeEvent = {
      version: 1,
      timestamp: "2026-07-15T00:00:03.000Z",
      type: "status_change",
      status: "done",
    };
    logger.append("a1", terminalStatus);
    expect(fsyncSpy).toHaveBeenCalledTimes(4);

    expect(readFileSync(logger.filePathFor("a1"), "utf8").trim().split("\n")).toHaveLength(4);

    openSpy.mockRestore();
    writeSpy.mockRestore();
    fsyncSpy.mockRestore();
    closeSpy.mockRestore();
  });

  test("does not fsync ordinary event lines (message, tool_call, non-terminal status_change)", () => {
    const fsyncSpy = spyOn(fs, "fsyncSync");
    const logger = new SessionLogger(dir);

    const message: LogMessageEvent = {
      version: 1,
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "message",
      role: "assistant",
      content: "hi",
    };
    const toolCall: LogToolCallEvent = {
      version: 1,
      timestamp: "2026-07-15T00:00:01.000Z",
      type: "tool_call",
      toolName: "Read",
      toolUseId: "t1",
      input: {},
    };
    const runningStatus: LogStatusChangeEvent = {
      version: 1,
      timestamp: "2026-07-15T00:00:02.000Z",
      type: "status_change",
      status: "running",
    };
    logger.append("a1", message);
    logger.append("a1", toolCall);
    logger.append("a1", runningStatus);

    expect(fsyncSpy).not.toHaveBeenCalled();
    fsyncSpy.mockRestore();
  });

  test("write failure: drops the line, never throws, and surfaces exactly one stderr line", () => {
    const errSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    const appendSpy = spyOn(fs, "appendFileSync").mockImplementation(() => {
      const err = new Error("no space left on device") as NodeJS.ErrnoException;
      err.code = "ENOSPC";
      throw err;
    });
    const logger = new SessionLogger(dir);

    const message: LogMessageEvent = {
      version: 1,
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "message",
      role: "assistant",
      content: "hi",
    };

    expect(() => logger.append("a1", message)).not.toThrow();
    expect(() => logger.append("a1", message)).not.toThrow();

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]?.[0]).toContain("ENOSPC");
    expect(errSpy.mock.calls[0]?.[0]).toContain(logger.filePathFor("a1"));

    appendSpy.mockRestore();
    errSpy.mockRestore();
  });

  test("recovery: first successful write after failures reports the dropped count once", () => {
    const errSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    const appendSpy = spyOn(fs, "appendFileSync").mockImplementation(() => {
      const err = new Error("disk full") as NodeJS.ErrnoException;
      err.code = "ENOSPC";
      throw err;
    });
    const logger = new SessionLogger(dir);
    const message: LogMessageEvent = {
      version: 1,
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "message",
      role: "assistant",
      content: "hi",
    };

    logger.append("a1", message);
    logger.append("a1", message);
    expect(errSpy).toHaveBeenCalledTimes(1); // one-time failure notice

    appendSpy.mockRestore(); // subsequent writes succeed for real
    logger.append("a1", message);

    expect(errSpy).toHaveBeenCalledTimes(2);
    expect(errSpy.mock.calls[1]?.[0]).toContain("recovered");
    expect(errSpy.mock.calls[1]?.[0]).toContain("2 line(s) were dropped");

    // A fresh failure after recovery surfaces again (state was reset).
    const appendSpy2 = spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw new Error("boom");
    });
    logger.append("a1", message);
    expect(errSpy).toHaveBeenCalledTimes(3);
    expect(errSpy.mock.calls[2]?.[0]).toContain("UNKNOWN");

    appendSpy2.mockRestore();
    errSpy.mockRestore();
  });

  test("fsync failure on a structurally critical line is handled like a write failure (dropped, never thrown)", () => {
    const errSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    const fsyncSpy = spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw new Error("fsync failed");
    });
    const logger = new SessionLogger(dir);

    expect(() => logger.append("a1", baseHeader())).not.toThrow();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]?.[0]).toContain("UNKNOWN");
    // The header line was not durably completed (fsync threw), so nothing readable is
    // asserted about file contents here — only that the failure was contained.

    fsyncSpy.mockRestore();
    errSpy.mockRestore();
  });

  test("redacts known config secrets (exact match, JSON-escaped form) from tool I/O", () => {
    const logger = new SessionLogger(dir, ["super-secret-token-value"]);
    const toolCall: LogToolCallEvent = {
      version: 1,
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "tool_call",
      toolName: "Bash",
      toolUseId: "t1",
      input: { command: 'curl -H "X-Token: super-secret-token-value"' },
    };
    logger.append("a1", toolCall);
    const contents = readFileSync(logger.filePathFor("a1"), "utf8");
    expect(contents).not.toContain("super-secret-token-value");
    expect(contents).toContain("[REDACTED:config-secret]");
  });

  test("redacts known secrets requiring JSON escaping (embedded quote)", () => {
    const secret = 'sekret"withquote12345';
    const logger = new SessionLogger(dir, [secret]);
    const toolCall: LogToolCallEvent = {
      version: 1,
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "tool_call",
      toolName: "Bash",
      toolUseId: "t1",
      input: { command: `echo ${secret}` },
    };
    logger.append("a1", toolCall);
    const contents = readFileSync(logger.filePathFor("a1"), "utf8");
    expect(() => JSON.parse(contents.trim())).not.toThrow();
    expect(contents).toContain("[REDACTED:config-secret]");
  });

  test("does not redact ordinary source-code identifiers like token/secret/password", () => {
    const logger = new SessionLogger(dir);
    const toolResult: LogMessageEvent = {
      version: 1,
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "message",
      role: "assistant",
      content: "const token = getToken(); // password field, secret handling here",
    };
    logger.append("a1", toolResult);
    const contents = readFileSync(logger.filePathFor("a1"), "utf8");
    expect(contents).toContain("const token = getToken()");
    expect(contents).not.toContain("REDACTED");
  });
});
