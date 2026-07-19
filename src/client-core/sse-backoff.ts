// Full-jitter exponential backoff for SSE reconnects (DH-0024), shared by the TUI and Web
// clients — DH-0184 extracted this out of `src/tui/sse-client.ts`'s `backoffDelayMs` and
// `src/web/client/sse.ts`'s `nextReconnectDelayMs`, which DH-0170 confirmed were
// byte-equivalent (same formula, same 1000ms/30000ms default constants).

/** Default initial delay before the first reconnect attempt after a drop. */
export const DEFAULT_RECONNECT_DELAY_MS = 1000;

/** Default cap on the backed-off delay (DH-0024): however many consecutive failures pile up,
 * never wait longer than this between attempts — an operator restarting the server shouldn't
 * have to wait minutes for the client to notice. */
export const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * `random() * min(cap, base * 2^attempt)`. `attempt` is the count of consecutive failures
 * *before* this one, so the very first retry is jittered around the plain `base` delay and
 * later retries grow from there, rather than hammering a down server on a flat interval
 * forever. Jitter (rather than using the capped value outright) keeps clients that all
 * dropped at the same moment (e.g. a server restart) from reconnecting in lockstep and
 * re-hammering it the instant it comes back.
 */
export function computeBackoffDelayMs(
  attempt: number,
  baseDelayMs: number = DEFAULT_RECONNECT_DELAY_MS,
  maxDelayMs: number = DEFAULT_MAX_RECONNECT_DELAY_MS,
  randomImpl: () => number = Math.random,
): number {
  const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return randomImpl() * capped;
}
