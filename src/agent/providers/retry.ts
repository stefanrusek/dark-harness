// Shared retry/backoff helper for provider adapters (DH-0009:
// tracking/DH-0009-provider-retry-backoff-and-error-taxonomy.md). Both anthropic.ts and
// bedrock.ts wrap every SDK failure in a classified ProviderError (see types.ts) and hand it
// to `withRetry`, which retries only `retryable` errors with bounded, jittered exponential
// backoff — a transient 429/5xx/network blip during an hours-long unattended dark-factory run
// no longer kills the whole session outright; a permanent error (bad auth, malformed request)
// still fails immediately with no wasted attempts.

export interface RetryPolicy {
  /** Total attempts, including the first (non-retry) one. Default 3. */
  maxAttempts?: number;
  /** Base delay before the first retry, doubled each subsequent attempt. Default 500ms. */
  baseDelayMs?: number;
  /** Upper bound on the (pre-jitter) computed delay. Default 8000ms. */
  maxDelayMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;

/** Full jitter (AWS's own recommended strategy): a uniformly random delay between 0 and the
 * exponential backoff value, rather than the raw exponential value itself — avoids many
 * concurrent sub-agents that all hit a rate limit at once retrying in lockstep. */
function computeDelayMs(attempt: number, policy: Required<RetryPolicy>): number {
  const exponential = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
  return Math.random() * exponential;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted before retry delay", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("aborted during retry delay", "AbortError"));
      },
      { once: true },
    );
  });
}

/**
 * Runs `attempt()` up to `policy.maxAttempts` times. Retries only when `attempt()` throws an
 * error for which `isRetryable(err)` returns true; any other error (or the final attempt's
 * error, retryable or not) is rethrown as-is to the caller — classification/wrapping into a
 * `ProviderError` happens in `attempt()` itself (each adapter's own try/catch), not here.
 */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  policy: RetryPolicy = {},
  signal?: AbortSignal,
): Promise<T> {
  const resolved: Required<RetryPolicy> = {
    maxAttempts: policy.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    baseDelayMs: policy.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    maxDelayMs: policy.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
  };

  let lastErr: unknown;
  for (let attemptNum = 1; attemptNum <= resolved.maxAttempts; attemptNum += 1) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attemptNum >= resolved.maxAttempts;
      if (isLastAttempt || !isRetryable(err)) {
        throw err;
      }
      await sleep(computeDelayMs(attemptNum, resolved), signal);
    }
  }
  // Unreachable (the loop always returns or throws), but keeps TS's control-flow analysis
  // happy without an explicit `never` return type.
  throw lastErr;
}
