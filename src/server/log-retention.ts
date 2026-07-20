// DH-0037 (tracking/DH-0037-no-log-rotation-or-run-summary-or-log-analysis-tool.md), piece
// 1 of 2: `.dh-logs/` rotation/prune. Config-gated, off by default — matches this project's
// established pattern for new knobs (LimitsConfig's doc comment in src/contracts/config.type.ts
// makes the same call for its own caps). Deliberately does NOT touch `summary.json` — that
// piece of DH-0037 is sequenced after DH-0050's Core round (see the ticket's owner note).

import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { LogRetentionConfig } from "../contracts/index.ts";

export interface PruneResult {
  /** Session ids (directory names under `logsRootDir`) that were deleted this pass, in the
   * order they were deleted. Empty when nothing qualified, or when pruning is disabled. */
  prunedSessionIds: string[];
}

interface SessionDirInfo {
  sessionId: string;
  path: string;
  /** Latest mtime among the directory's own files — used as "last write" for both the
   * age cutoff and the oldest-first size-eviction order. */
  lastModifiedMs: number;
  totalBytes: number;
}

function statSessionDir(root: string, sessionId: string): SessionDirInfo | undefined {
  const path = join(root, sessionId);
  let entries: string[];
  try {
    entries = readdirSync(path);
  } catch {
    // Not a directory, or disappeared concurrently (e.g. another process pruning too) —
    // simply not a session we can account for.
    return undefined;
  }
  let totalBytes = 0;
  let lastModifiedMs = 0;
  for (const entry of entries) {
    try {
      const st = statSync(join(path, entry));
      totalBytes += st.size;
      if (st.mtimeMs > lastModifiedMs) lastModifiedMs = st.mtimeMs;
    } catch {
      // File disappeared between readdir and stat; ignore it rather than fail the pass.
    }
  }
  return { sessionId, path, lastModifiedMs, totalBytes };
}

/**
 * Prunes old session directories directly under `logsRootDir` (normally `.dh-logs`,
 * `join(process.cwd(), ".dh-logs")` at every call site today).
 *
 * No-op unless `config` sets at least one of `maxAgeMs`/`maxTotalBytes` — omitting both (the
 * default, and the value when `dh.json` has no `logRetention` key at all) preserves today's
 * behavior of never deleting anything.
 *
 * - `maxAgeMs`: any session directory whose most recently written file is older than this
 *   is deleted outright, regardless of total size.
 * - `maxTotalBytes`: after age-pruning, if the remaining total size across all session
 *   directories still exceeds this, the oldest-by-last-write directories are deleted one at
 *   a time until under the cap (or nothing is left to delete).
 *
 * `excludeSessionId` (the session this very process is about to write to, or already
 * writing to) is never pruned even if it would otherwise qualify — a live session's own
 * directory must never be pulled out from under it.
 *
 * Best-effort: an unreadable `logsRootDir` (e.g. first run, directory doesn't exist yet) is
 * treated as "nothing to prune", not an error — this must never be what prevents a session
 * from starting.
 */
export function pruneLogDirectories(
  logsRootDir: string,
  config: LogRetentionConfig | undefined,
  now: number,
  excludeSessionId?: string,
): PruneResult {
  if (!config || (config.maxAgeMs === undefined && config.maxTotalBytes === undefined)) {
    return { prunedSessionIds: [] };
  }

  let sessionIds: string[];
  try {
    sessionIds = readdirSync(logsRootDir);
  } catch {
    return { prunedSessionIds: [] };
  }

  let dirs = sessionIds
    .filter((id) => id !== excludeSessionId)
    .map((id) => statSessionDir(logsRootDir, id))
    .filter((d): d is SessionDirInfo => d !== undefined);

  const pruned: string[] = [];

  if (config.maxAgeMs !== undefined) {
    const cutoff = now - config.maxAgeMs;
    const keep: SessionDirInfo[] = [];
    for (const dir of dirs) {
      if (dir.lastModifiedMs < cutoff) {
        rmSync(dir.path, { recursive: true, force: true });
        pruned.push(dir.sessionId);
      } else {
        keep.push(dir);
      }
    }
    dirs = keep;
  }

  if (config.maxTotalBytes !== undefined) {
    dirs = [...dirs].sort((a, b) => a.lastModifiedMs - b.lastModifiedMs);
    let totalBytes = dirs.reduce((sum, d) => sum + d.totalBytes, 0);
    for (const dir of dirs) {
      if (totalBytes <= config.maxTotalBytes) break;
      rmSync(dir.path, { recursive: true, force: true });
      pruned.push(dir.sessionId);
      totalBytes -= dir.totalBytes;
    }
  }

  return { prunedSessionIds: pruned };
}
