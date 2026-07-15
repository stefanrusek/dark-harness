import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { LogLine } from "../contracts/index.ts";

/**
 * JSONL-per-agent session logger (ADR 0005). One append-only file per agent under
 * `logDir`, named `<agentId>.jsonl` (agentId is percent-encoded into the filename so a
 * hostile/unexpected agent id — e.g. containing `..` or `/` — can never escape `logDir`).
 *
 * Writes are synchronous appends: the simplest way to guarantee both ordering (no
 * interleaving between concurrent callers writing to the same file) and crash tolerance —
 * ADR 0005 requires the log to "tolerate the process dying mid-write" via "append-only
 * writes, one JSON object per line, so a truncated last line doesn't corrupt earlier
 * ones." A synchronous, fully-completed-before-returning append per call gives exactly
 * that: at most the very last write can be lost or truncated, never an earlier one.
 */
export class SessionLogger {
  readonly logDir: string;

  constructor(logDir: string) {
    this.logDir = logDir;
    mkdirSync(logDir, { recursive: true });
  }

  filePathFor(agentId: string): string {
    return join(this.logDir, `${encodeURIComponent(agentId)}.jsonl`);
  }

  append(agentId: string, line: LogLine): void {
    appendFileSync(this.filePathFor(agentId), `${JSON.stringify(line)}\n`, "utf8");
  }
}
