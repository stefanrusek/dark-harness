// DH-0126/DH-0136: pure scroll-offset/windowing model for the transcript pane, ported from
// privateer's `src/ui/scroll-viewport.ts` (see DH-0133's Notes — cited there as reusable prior
// art for exactly this shape, not a drop-in dependency since it lives in a different repo/
// binary). A pane's content is an ordered list of already-wrapped visual rows; the viewport
// shows a fixed-height window into it. This module owns all the offset arithmetic (clamping,
// paging, `atBottom`); the Ink component only stores the offset and calls these helpers — same
// "controller stores just the offset" split as privateer's.
//
// This ticket's scroll-viewport windowing consumes whatever offset DH-0126's own mouse/key
// input-parsing fix produces (that ticket is separate scope, per DH-0133's Notes) — it does not
// itself wire a scroll trigger.

/** The scroll position of one viewport. `offset` is the first visible row; 0 = top. */
export interface ScrollState {
  readonly offset: number;
}

/**
 * The largest valid offset: rows below the viewport when scrolled to the very top. Zero when
 * content fits. A non-positive viewport height means every row is below the fold.
 */
export function maxOffset(totalLines: number, viewportHeight: number): number {
  if (viewportHeight <= 0) {
    return Math.max(0, totalLines);
  }
  return Math.max(0, totalLines - viewportHeight);
}

/** Clamp an offset into `[0, maxOffset]`. */
export function clampOffset(offset: number, totalLines: number, viewportHeight: number): number {
  const max = maxOffset(totalLines, viewportHeight);
  if (offset < 0) return 0;
  if (offset > max) return max;
  return offset;
}

/** The visible window of rows for an offset. The offset is clamped first, so an out-of-range
 * value never produces an empty/misaligned slice. A non-positive viewport yields no rows. */
export function visibleSlice<T>(lines: readonly T[], offset: number, viewportHeight: number): T[] {
  if (viewportHeight <= 0) return [];
  const start = clampOffset(offset, lines.length, viewportHeight);
  return lines.slice(start, start + viewportHeight);
}

/** Move the offset by `delta` rows (positive = down), clamped. */
export function scrollBy(
  state: ScrollState,
  delta: number,
  totalLines: number,
  viewportHeight: number,
): ScrollState {
  return { offset: clampOffset(state.offset + delta, totalLines, viewportHeight) };
}

/** Scroll to the very top. */
export function toTop(): ScrollState {
  return { offset: 0 };
}

/** Scroll to the very bottom. */
export function toBottom(totalLines: number, viewportHeight: number): ScrollState {
  return { offset: maxOffset(totalLines, viewportHeight) };
}

/** Whether the offset is pinned to the bottom (clamped offset === maxOffset) — drives
 * DH-0129-equivalent "only auto-scroll when already at the bottom" behavior for the transcript
 * pane. */
export function atBottom(offset: number, totalLines: number, viewportHeight: number): boolean {
  return clampOffset(offset, totalLines, viewportHeight) === maxOffset(totalLines, viewportHeight);
}
