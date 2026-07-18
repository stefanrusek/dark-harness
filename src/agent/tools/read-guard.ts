// Round 13 (docs/handoffs/core.md, P2 item 10) — read-before-Edit/Write enforcement shared
// by edit.ts and write.ts. Real Claude Code refuses to Edit or overwrite-Write a file the
// model hasn't Read first in the current conversation, and refuses if the file changed on
// disk since that read. `dh`'s operating model (all-permissions, no human review, concurrent
// sub-agents sharing one filesystem) makes this *more* valuable, not less — it's exactly the
// guard against blind edits and stale-read races, per Fable's adopted recommendation in the
// conformance audit that raised this.

import { stat } from "node:fs/promises";
import type { ToolContext } from "./types.type.ts";

export interface ReadGuardError {
  error: string;
}

/** Checks `absPath` against `ctx.readRegistry` (populated by the Read tool). Returns null when
 * the edit/overwrite may proceed, or a ReadGuardError describing why not. Does not itself
 * mutate the registry — callers record the new state after a successful write. */
export async function checkReadBeforeWrite(
  ctx: ToolContext,
  absPath: string,
  toolName: string,
): Promise<ReadGuardError | null> {
  const recorded = ctx.readRegistry.get(absPath);
  if (!recorded) {
    return {
      error: `${toolName} tool error: ${absPath} has not been Read in this conversation yet. Use the Read tool first, then retry.`,
    };
  }
  const current = await stat(absPath);
  if (current.mtimeMs !== recorded.mtimeMs || current.size !== recorded.size) {
    return {
      error: `${toolName} tool error: ${absPath} was modified on disk since it was last Read. Read it again before editing to avoid clobbering the newer version.`,
    };
  }
  return null;
}

/** Records (or refreshes) the read-registry entry for `absPath` after a successful Read or
 * write — so a just-written file is immediately editable without requiring a redundant
 * re-Read, and a freshly-edited file's entry stays current for a subsequent Edit in the same
 * turn. */
export async function recordRead(
  ctx: ToolContext,
  absPath: string,
): Promise<{ mtimeMs: number; size: number }> {
  const current = await stat(absPath);
  const entry = { mtimeMs: current.mtimeMs, size: current.size };
  ctx.readRegistry.set(absPath, entry);
  return entry;
}
