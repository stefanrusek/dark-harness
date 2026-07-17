// DH-0126: the seam between app.ts's raw stdin mouse parsing and whichever `<TranscriptPane>`
// is currently mounted (root or agent-detail view — never both). The transcript's scroll
// *offset* deliberately stays local component state (see TranscriptPane.tsx's header comment
// and scroll-viewport.ts's — "controller stores just the offset", matching privateer, and
// keeping `state.ts`/`types.ts` free of render-only offset bookkeeping). This bus only carries
// the raw trigger (a wheel notch happened, here's the line delta) from app.ts's stdin listener
// down to whichever pane should react to it; it owns no state of its own beyond the listener
// set.
export type ScrollListener = (deltaLines: number) => void;

export interface ScrollBus {
  subscribe(listener: ScrollListener): () => void;
  emit(deltaLines: number): void;
}

/** One bus per TUI session (created once in app.ts, threaded through the Ink tree as a prop —
 * never a module-level singleton, so tests can create independent instances). */
export function createScrollBus(): ScrollBus {
  const listeners = new Set<ScrollListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(deltaLines) {
      for (const listener of listeners) {
        listener(deltaLines);
      }
    },
  };
}
