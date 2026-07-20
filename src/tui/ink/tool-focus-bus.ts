// DH-0246: the seam between app.ts's raw stdin key parsing and whichever `<TranscriptPane>`
// is currently mounted (root or agent-detail view — never both) — same pattern as
// `scroll-bus.ts` (DH-0126), and for the same reason. Which tool-call row is focused, which
// groups are expanded, and which tool-call rows have their detail open are all deliberately
// local `TranscriptPane` state, not `TuiState` (see that file's header comment) — `state.ts`'s
// reducer has no notion of transcript grouping/expansion at all, so it can't decide "how many
// focusable rows are there right now" to move/clamp a selection index the way it does for
// `AgentTree`/`PickerView`'s `selectedIndex`. This bus instead carries the raw intent (an
// up/down move, or an activate) down to whichever pane should react to it; `app.ts` decides
// *when* a keystroke means "move the transcript focus" vs. its normal composer/tree/picker
// meaning (see app.ts's own comment at the call site), and the pane resolves the intent against
// whatever it currently has expanded — it owns no state of its own beyond the listener set.
export type ToolFocusEvent = "up" | "down" | "activate";
export type ToolFocusListener = (event: ToolFocusEvent) => void;

export interface ToolFocusBus {
  subscribe(listener: ToolFocusListener): () => void;
  emit(event: ToolFocusEvent): void;
}

/** One bus per TUI session (created once in app.ts, threaded through the Ink tree as a prop —
 * never a module-level singleton, so tests can create independent instances). */
export function createToolFocusBus(): ToolFocusBus {
  const listeners = new Set<ToolFocusListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}
