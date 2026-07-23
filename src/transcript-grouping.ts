// DH-0246: the pure "which consecutive tool-call turns collapse into one group" partitioning
// rule, lifted out of `src/web/client/components/Transcript.tsx` (DH-0199) so the TUI
// (`src/tui/ink/TranscriptPane.tsx`) can reuse the exact same algorithm instead of re-deriving
// it. Framework/DOM-agnostic on purpose — same precedent as `src/design-tokens.ts` (a shared
// non-wire module both clients import; not part of `src/contracts/`, so no architect sign-off
// needed per that file's own doc comment).
//
// Deliberately generic over `T` rather than importing either client's own `Turn` type: the Web
// and TUI `Turn` interfaces carry different extra fields (timestamp, queuedMessageId, ...) but
// agree on the two fields this algorithm actually reads. Structural typing (`GroupableTurn`)
// lets both `Transcript.tsx` and `TranscriptPane.tsx` pass their own `Turn` straight through
// with no adapter/mapping step.

/** The minimal shape `groupTranscript` needs from a turn — every real client `Turn` satisfies
 * this structurally. `terminalStatus` is typed loosely (not `AgentStatus`) so this module
 * doesn't need to import from `src/contracts/` just to describe "present or absent". */
export interface GroupableTurn {
  role: string;
  terminalStatus?: unknown;
}

/** `groupTranscript`'s output — either a single turn to render as-is, or a run of 2+
 * consecutive plain tool-call turns to render as one collapsible group. `startIndex` is the
 * transcript index of the item's first turn — a stable identity for an append-only transcript
 * (never reordered/spliced), usable as a React key (Web) or a focus/expand-state key (TUI). */
export type RenderItem<T extends GroupableTurn> =
  | { kind: "turn"; startIndex: number; turn: T }
  | { kind: "group"; startIndex: number; turns: T[] };

/** Whether `turn` is a plain tool-call marker eligible for grouping — a `role: "tool"` turn
 * that is NOT a terminal-status marker (DH-0130's "Agent done/failed/stopped" turns stay
 * standalone and visually distinct; grouping them with ordinary tool calls would bury the one
 * event an operator scanning the transcript most needs to notice). */
export function isGroupableToolTurn<T extends GroupableTurn>(turn: T): boolean {
  return turn.role === "tool" && !turn.terminalStatus;
}

/**
 * DH-0199 (Web) / DH-0246 (TUI): scans `transcript` for maximal runs of consecutive groupable
 * tool-call turns (see `isGroupableToolTurn`) — any other-role turn (including a
 * terminal-status marker) breaks a run. A run of 2+ becomes one `"group"` item; a lone tool
 * call (run length 1) renders standalone via `"turn"`, so a single tool call between two agent
 * turns doesn't get wrapped in a pointless one-item expando.
 */
export function groupTranscript<T extends GroupableTurn>(transcript: T[]): RenderItem<T>[] {
  const items: RenderItem<T>[] = [];
  let i = 0;
  while (i < transcript.length) {
    // `i < transcript.length` guarantees a value here; `noUncheckedIndexedAccess` can't see
    // that invariant across the loop bound, hence the assertion rather than an unreachable
    // (and therefore uncoverable) defensive branch.
    const turn = transcript[i] as T;
    if (!isGroupableToolTurn(turn)) {
      items.push({ kind: "turn", startIndex: i, turn });
      i++;
      continue;
    }
    const run: T[] = [];
    const startIndex = i;
    while (i < transcript.length) {
      const candidate = transcript[i] as T;
      if (!isGroupableToolTurn(candidate)) break;
      run.push(candidate);
      i++;
    }
    if (run.length >= 2) {
      items.push({ kind: "group", startIndex, turns: run });
    } else {
      // run.length === 1 here: the while loop above always pushes at least one turn before `i`
      // can have advanced past `startIndex` (the branch above already excluded the
      // non-groupable case), so `run[0]` is always defined.
      items.push({ kind: "turn", startIndex, turn: run[0] as T });
    }
  }
  return items;
}
