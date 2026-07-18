// DH-0104 (docs/design/style-guide.md §4): shared, canonical number/cost/elapsed
// formatters. Extracted so the three human-facing surfaces (TUI, Web, `dh logs`) render the
// same value the same way, instead of three hand-kept-in-sync copies quietly drifting apart
// (which is exactly how this ticket got filed — see the ticket's survey table). Pure
// functions only, no DOM/node/process access, so every surface (including the browser-
// bundled Web client) can import it unmodified — same pattern as `src/terminal.constant.ts`'s shared
// spinner constants.
//
// Two-tier rules, per the owner's 2026-07-16 ruling (recorded in the style guide):
//
// - Cost: 2-dp + `<$0.01` for tiny nonzero + `—` for unknown, in every *interactive*
//   context (TUI tree/root/agent views, Web sidebar/strip/detail). `dh logs`
//   (`src/server/log-analysis.ts`) is a deliberate, documented exception that keeps 4-dp
//   precision for audit-dump purposes — it does NOT use `formatCostUsd` below, it keeps its
//   own `formatCost`.
// - Tokens: compact `12.3k`/`1.2M` form in glanceable chrome (TUI tree rows, Web badges/
//   strips), full comma form (`12,345`) in detail/log contexts (`dh logs`, TUI/Web detail
//   panels). One rule per context-class, applied identically regardless of which surface —
//   `formatTokenCountCompact` / `formatTokenCountFull` below, picked per call site.
// - Elapsed: spaces + "just now" affordance (`3m 12s`, sub-second reads as `just now`) in
//   every surface — elapsed has no glanceable/detail split, unlike cost/tokens.

/** Compact human token count: 950 -> "950", 12_345 -> "12.3k", 1_234_567 -> "1.2M". For
 * glanceable chrome only (TUI tree rows, Web badges/strips) — use `formatTokenCountFull` for
 * detail/log contexts. */
export function formatTokenCountCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Full comma-grouped token count: 12345 -> "12,345". For detail/log contexts (`dh logs`,
 * TUI/Web detail panels) — use `formatTokenCountCompact` for glanceable chrome. */
export function formatTokenCountFull(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

/** Canonical interactive-surface cost format: 2-dp, `<$0.01` for a tiny nonzero amount, `—`
 * (em dash) for an unknown/unpriced cost — never `$0.00`, which misrepresents an unpriced
 * model as free. `undefined`/`null` both mean "unknown" (surfaces vary on which they thread
 * through). Excluded from totals is the caller's responsibility (see each surface's totals
 * function) — this only formats a single already-decided value. NOT used by `dh logs`, which
 * keeps 4-dp precision as a deliberate exception — see `src/server/log-analysis.ts`'s own
 * `formatCost`. */
export function formatCostUsd(costUsd: number | null | undefined): string {
  if (costUsd === null || costUsd === undefined || !Number.isFinite(costUsd)) return "—";
  if (costUsd === 0) return "$0.00";
  if (costUsd < 0.01) return "<$0.01";
  return `$${costUsd.toFixed(2)}`;
}

/**
 * Canonical elapsed-duration format, used by every surface: "just now" (sub-second),
 * "42s", "3m 12s", "1h 05m" — spaces between unit groups, "just now" instead of "0s" for
 * sub-second durations. Deliberately coarse (drops sub-second precision past the "just now"
 * threshold) since its job is letting an operator eyeball "still a normal turn" vs. "this
 * has been running a suspiciously long time," not precise timing.
 */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 1) return "just now";
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${totalHours}h ${String(minutes).padStart(2, "0")}m`;
}

/** Shared cross-surface test vectors (DH-0104's "minimum bar" if a literal shared import
 * weren't practical — kept anyway, alongside the shared import itself, as a belt-and-braces
 * same-input -> asserted-identical-output regression guard every surface's test file
 * imports and runs against its own call sites, not just against the functions above
 * directly). */
export const ELAPSED_VECTORS: ReadonlyArray<readonly [number, string]> = Object.freeze([
  [0, "just now"],
  [999, "just now"],
  [1000, "1s"],
  [42_000, "42s"],
  [59_999, "59s"],
  [60_000, "1m 00s"],
  [192_000, "3m 12s"],
  [3_600_000, "1h 00m"],
  [3_900_000, "1h 05m"],
]);

export const TOKEN_COMPACT_VECTORS: ReadonlyArray<readonly [number, string]> = Object.freeze([
  [0, "0"],
  [950, "950"],
  [12_345, "12.3k"],
  [999_500, "999.5k"],
  [1_234_567, "1.2M"],
]);

export const TOKEN_FULL_VECTORS: ReadonlyArray<readonly [number, string]> = Object.freeze([
  [0, "0"],
  [950, "950"],
  [12_345, "12,345"],
  [1_234_567, "1,234,567"],
]);

export const COST_VECTORS: ReadonlyArray<readonly [number | null | undefined, string]> =
  Object.freeze([
    [undefined, "—"],
    [null, "—"],
    [0, "$0.00"],
    [0.001, "<$0.01"],
    [0.0456, "$0.05"],
    [1.006, "$1.01"],
    [12.3, "$12.30"],
  ]);
