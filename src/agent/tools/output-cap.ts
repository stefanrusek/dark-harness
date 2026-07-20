// Shared output cap — Round 13 (docs/handoffs/core.md, P1 item 1): real Claude Code caps
// what a Bash-shaped tool returns to the model with a truncation notice naming the true total
// size; `dh` previously buffered and returned everything unbounded.
//
// DH-0080 (tracking/DH-0080-*.md): live-run testing against real Claude Code found the actual
// truncation *shape* diverges from dh's original tail-cut-inline-notice model. Real Claude
// Code, when a command's output exceeds its cap, saves the FULL output to a file on disk and
// returns a HEAD preview (first ~2KB) inline, plus the saved path — not a tail slice with the
// earlier output silently discarded forever. `capOutputWithSavedFile` below implements that
// shape for Bash's foreground return specifically (see bash.ts). The original `capOutput`
// (tail-keeping, inline-only, no disk save) is kept as-is and still used by TaskOutput
// (task-output.ts): TaskOutput already has its own recovery path for "see the rest" — its
// incremental-delta-by-default plus `full: true` re-fetch — so it doesn't have the same "output
// permanently gone" problem Bash's one-shot foreground return had. Scoping this fix to Bash's
// own capping path (not a shared result-capping layer for every tool) is a deliberate call: the
// two tools' "how do I get the rest" story is genuinely different, and TaskOutput's story
// already works without a filesystem side effect. If a third foreground-and-uncapped tool shows
// up later, revisit whether this belongs in one shared layer instead.

import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const OUTPUT_CAP_CHARS = 30_000;

// DH-0080: real Claude Code's observed preview window was "first 2KB" — used verbatim here.
export const HEAD_PREVIEW_CHARS = 2_000;
// dh addition, beyond what was observed in real Claude Code (which is head-only): commands that
// fail often put the actually-useful error message at the *end* of their output (the ticket's
// own flagged risk of going head-only). Keeping a short tail alongside the head preview is a
// deliberate, documented divergence — cheap immediate error visibility — while the full output
// is still always recoverable from the saved file either way.
export const TAIL_PREVIEW_CHARS = 2_000;

// DH-0080: where saved full-output files live. Not session-scoped (ToolContext carries no
// session/log directory today — see types.ts), so this uses its own stable temp subdirectory
// instead, cleaned up by a simple file-count cap (below) rather than a session-end hook.
const OUTPUT_SAVE_DIR = Object.freeze(join(tmpdir(), "dh-bash-output"));
// DH-0080: cleanup policy — rather than session-scoped deletion (no session lifecycle hook
// reaches this layer) or time-based expiry (extra bookkeeping for little benefit here), cap the
// directory at a fixed file count and evict the oldest files by mtime whenever it's exceeded.
// Bounds disk usage to `MAX_SAVED_FILES` full-output blobs at any time without needing to know
// anything about sessions.
const MAX_SAVED_FILES = 50;

export interface CappedOutput {
  text: string;
  truncated: boolean;
  totalLength: number;
}

export interface SavedCappedOutput extends CappedOutput {
  /** Absolute path the full, untruncated output was saved to — only set when `truncated`. */
  savedPath?: string;
}

/** Caps `text` to at most `capChars`, keeping the tail (the most recent / most relevant
 * output for a long-running command) and prepending a notice stating the true total size
 * when truncation occurred. Kept as a pure function so it's trivially unit-testable without
 * spinning up a real subprocess. Used by TaskOutput (task-output.ts), which has its own
 * separate "get the rest" recovery path (incremental delta + `full: true` re-fetch) — see this
 * file's header comment for why Bash's foreground path uses `capOutputWithSavedFile` instead. */
export function capOutput(text: string, capChars: number = OUTPUT_CAP_CHARS): CappedOutput {
  if (text.length <= capChars) {
    return { text, truncated: false, totalLength: text.length };
  }
  const kept = text.slice(text.length - capChars);
  const notice = `[output truncated: showing last ${capChars} of ${text.length} total chars]\n`;
  return { text: `${notice}${kept}`, truncated: true, totalLength: text.length };
}

/** Deletes the oldest files in `dir` until at most `maxFiles` remain. Called immediately after
 * this module's own `mkdir(dir, { recursive: true })` + write, so `dir` is guaranteed to exist;
 * no defensive existence-check is needed here. */
async function pruneOldSavedFiles(dir: string, maxFiles: number): Promise<void> {
  const entries = await readdir(dir);
  if (entries.length <= maxFiles) return;

  const withTimes = await Promise.all(
    entries.map(async (name) => {
      const path = join(dir, name);
      const s = await stat(path);
      return { path, mtimeMs: s.mtimeMs };
    }),
  );

  withTimes.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const excess = withTimes.length - maxFiles;
  for (let i = 0; i < excess; i++) {
    const entry = withTimes[i];
    if (entry) await rm(entry.path, { force: true });
  }
}

/** DH-0080: Bash's foreground output-capping shape — matches real Claude Code's observed
 * "save full output to a file, preview the head inline, report the path back" behavior instead
 * of dh's original tail-cut-inline-only model. When `text` exceeds `capChars`, the full text is
 * written to a fresh file under a stable temp directory (pruned to `MAX_SAVED_FILES` newest
 * files afterward), and the returned notice includes: a head preview (first
 * `HEAD_PREVIEW_CHARS` chars, matching real Claude Code), a tail preview (dh's own addition —
 * see this file's header comment), the saved path, and the true total length — so the agent can
 * `Read` the saved path (with `offset`/`limit`) to page through anything the previews cut off. */
export async function capOutputWithSavedFile(
  text: string,
  capChars: number = OUTPUT_CAP_CHARS,
): Promise<SavedCappedOutput> {
  if (text.length <= capChars) {
    return { text, truncated: false, totalLength: text.length };
  }

  await mkdir(OUTPUT_SAVE_DIR, { recursive: true });
  const savedPath = join(OUTPUT_SAVE_DIR, `${crypto.randomUUID()}.txt`);
  await writeFile(savedPath, text, "utf-8");
  await pruneOldSavedFiles(OUTPUT_SAVE_DIR, MAX_SAVED_FILES);

  const head = text.slice(0, HEAD_PREVIEW_CHARS);
  const tail = text.slice(Math.max(HEAD_PREVIEW_CHARS, text.length - TAIL_PREVIEW_CHARS));

  const omitted = Math.max(0, text.length - head.length - tail.length);
  const notice = `[Output too large (${text.length} chars). Full output saved to: ${savedPath}\nPreview (first ${HEAD_PREVIEW_CHARS} chars):]\n${head}\n[... ${omitted} more chars omitted; read '${savedPath}' (with offset/limit) for the rest ...]\n[Tail preview (last ${TAIL_PREVIEW_CHARS} chars) — dh addition beyond real Claude Code's head-only preview, since command failures often put the error at the end:]\n${tail}`;

  return { text: notice, truncated: true, totalLength: text.length, savedPath };
}
