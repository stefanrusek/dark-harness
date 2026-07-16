import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { LogLine } from "../contracts/index.ts";
import { redactSecrets } from "./redact.ts";

/**
 * JSONL-per-agent session logger (ADR 0005). One append-only file per agent under
 * `logDir`, named `<agentId>.jsonl` (agentId is percent-encoded into the filename so a
 * hostile/unexpected agent id — e.g. containing `..` or `/` — can never escape `logDir`).
 *
 * **Durability guarantee (DH-0020 D2; corrected from the previous, overstated claim that
 * "at most the very last write can be lost"** — that was only ever true across a *process*
 * crash, not a host crash/power loss, since the kernel page cache survives the former but
 * not the latter):
 *   - **Tier 1 — every event line: process-crash-safe.** A synchronous, fully-completed
 *     append (`appendFileSync`) means at most the final line is lost/truncated if the
 *     *process* dies mid-write; every earlier line is intact. This is the only guarantee
 *     for ordinary event lines.
 *   - **Tier 2 — structurally critical lines: host-crash-safe.** `header`, `completed`,
 *     `failed`, and any `status_change` whose status is terminal (`done`/`failed`/
 *     `stopped`) are written with an explicit `fsync` before the file descriptor is closed
 *     (see `isStructurallyCritical`/`writeSyncFsync`). These are the lines post-hoc
 *     analysis cannot live without — the agent tree (first-lines-only reconstruction) and
 *     each agent's verdict — so they survive a host crash/power loss, not just a process
 *     crash.
 *   - **Not guaranteed:** durability of ordinary event lines across a host crash/power
 *     loss. Per-line fsync was considered and rejected on cost (a real dark-factory session
 *     is order-5k-10k log appends; an fsync per line would tax every agent turn to defend
 *     against a failure mode — power loss — in which the run is dead anyway).
 *
 * **Write-error handling (DH-0020 D1):** a write/fsync failure (ENOSPC, EACCES, EROFS, or
 * anything else the underlying `fs` call throws) is caught, never propagated — the log
 * write failing must not be what kills the run it exists to make diagnosable. The line is
 * dropped (no buffering, no retry: these errors don't resolve between two adjacent
 * appends). Per file: the *first* failure emits one stderr line naming the path and error
 * code and noting further drops will be silent; the first *successful* write after one or
 * more failures emits one stderr recovery line naming how many lines were dropped, then
 * resets the per-file state so a later new failure surfaces again.
 *
 * **Secrets redaction (DH-0020 D3):** every serialized line is passed through
 * `redactSecrets` before being written — both `knownSecrets` (exact-match config secrets:
 * `security.token`, provider `apiKey`s, MCP header values) and the fixed high-precision
 * pattern table. See `redact.ts`'s doc comment for the full mechanism and rationale. This
 * is the log-writing-layer implementation of ADR 0004's "never logged" promise; it does not
 * apply to the live SSE stream or the agent's own in-context messages (see `redact.ts`).
 */
export class SessionLogger {
  readonly logDir: string;
  private readonly knownSecrets: readonly string[];
  private readonly failureState = new Map<
    string,
    { droppedCount: number; lastErrorCode: string | undefined }
  >();

  constructor(logDir: string, knownSecrets: readonly string[] = []) {
    this.logDir = logDir;
    this.knownSecrets = knownSecrets;
    mkdirSync(logDir, { recursive: true });
  }

  filePathFor(agentId: string): string {
    return join(this.logDir, `${encodeURIComponent(agentId)}.jsonl`);
  }

  append(agentId: string, line: LogLine): void {
    const path = this.filePathFor(agentId);
    const serialized = `${redactSecrets(JSON.stringify(line), this.knownSecrets)}\n`;
    try {
      if (isStructurallyCritical(line)) {
        writeAndFsync(path, serialized);
      } else {
        appendFileSync(path, serialized, "utf8");
      }
      this.handleWriteSuccess(path);
    } catch (err) {
      this.handleWriteFailure(path, err);
    }
  }

  private handleWriteFailure(path: string, err: unknown): void {
    const code = errorCodeOf(err);
    const existing = this.failureState.get(path);
    if (existing) {
      existing.droppedCount++;
      existing.lastErrorCode = code;
      return;
    }
    this.failureState.set(path, { droppedCount: 1, lastErrorCode: code });
    process.stderr.write(
      `dh: log write failed for ${path} (${code}); further drops for this file will be silent\n`,
    );
  }

  private handleWriteSuccess(path: string): void {
    const state = this.failureState.get(path);
    if (!state) return;
    process.stderr.write(
      `dh: log writing recovered for ${path}; ${state.droppedCount} line(s) were dropped\n`,
    );
    this.failureState.delete(path);
  }
}

/** `header`, `completed`, `failed`, and terminal `status_change` lines get the host-crash-
 * safe fsync tier (DH-0020 D2); everything else (message/tool_call/tool_result/token_usage,
 * and any non-terminal status_change) is Tier 1 only. */
function isStructurallyCritical(line: LogLine): boolean {
  if (line.type === "header" || line.type === "completed" || line.type === "failed") {
    return true;
  }
  if (line.type === "status_change") {
    return line.status === "done" || line.status === "failed" || line.status === "stopped";
  }
  return false;
}

/** Writes `contents` to `path` (append mode) and fsyncs before closing, so the line
 * survives a host crash, not just a process crash — see the class doc comment's Tier 2.
 * Any failure (open/write/fsync/close) propagates to the caller, which handles it exactly
 * like an ordinary write failure (DH-0020 D1: never thrown further, dropped + accounted). */
function writeAndFsync(path: string, contents: string): void {
  const fd = openSync(path, "a");
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function errorCodeOf(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return "UNKNOWN";
}
