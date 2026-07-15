import { describe, expect, test } from "bun:test";
import { withRetry } from "./retry.ts";

describe("withRetry", () => {
  test("returns the result immediately when the first attempt succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return "ok";
      },
      () => true,
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  test("does not retry a non-retryable error, even with attempts remaining", async () => {
    let calls = 0;
    const attempt = async () => {
      calls += 1;
      throw new Error("permanent");
    };
    await expect(
      withRetry(attempt, () => false, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }),
    ).rejects.toThrow("permanent");
    expect(calls).toBe(1);
  });

  test("retries a retryable error up to maxAttempts, then throws the last error", async () => {
    let calls = 0;
    const attempt = async () => {
      calls += 1;
      throw new Error(`attempt ${calls}`);
    };
    await expect(
      withRetry(attempt, () => true, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 }),
    ).rejects.toThrow("attempt 3");
    expect(calls).toBe(3);
  });

  test("succeeds on a later attempt after retryable failures", async () => {
    let calls = 0;
    const attempt = async () => {
      calls += 1;
      if (calls < 3) throw new Error("still failing");
      return "eventually ok";
    };
    const result = await withRetry(attempt, () => true, {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 2,
    });
    expect(result).toBe("eventually ok");
    expect(calls).toBe(3);
  });

  test("defaults to 3 total attempts when no policy is given", async () => {
    let calls = 0;
    const attempt = async () => {
      calls += 1;
      throw new Error("always fails");
    };
    // Use a policy override for delay only isn't possible without maxAttempts here since we
    // want to prove the *default* maxAttempts — but real default delays (500ms/8000ms cap)
    // would make this test slow, so this test only checks call count with tiny delays,
    // confirming default maxAttempts (3) via an explicit assertion on call count while still
    // keeping the run fast by supplying tiny delay bounds (delays are independent of
    // maxAttempts's default).
    await expect(
      withRetry(attempt, () => true, { baseDelayMs: 1, maxDelayMs: 1 }),
    ).rejects.toThrow();
    expect(calls).toBe(3);
  });

  test("an already-aborted signal at the moment the retry delay starts rejects immediately", async () => {
    let calls = 0;
    const controller = new AbortController();
    const attempt = async () => {
      calls += 1;
      if (calls === 1) controller.abort();
      throw new Error("retryable failure");
    };
    await expect(
      withRetry(
        attempt,
        () => true,
        { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 1000 },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test("aborting while genuinely still waiting mid-delay stops further attempts", async () => {
    let calls = 0;
    const controller = new AbortController();
    const attempt = async () => {
      calls += 1;
      throw new Error("retryable failure");
    };
    // Abort fires asynchronously, after sleep()'s timer has already started waiting (not
    // synchronously before it, unlike the "already-aborted" test above) — exercises the
    // addEventListener("abort", ...) callback path in retry.ts's sleep(), not just its
    // upfront `signal?.aborted` check.
    setTimeout(() => controller.abort(), 5);
    await expect(
      withRetry(
        attempt,
        () => true,
        { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 1000 },
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test("maxAttempts: 0 rejects without ever calling attempt() (defensive fallback path)", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          return "unreachable";
        },
        () => true,
        { maxAttempts: 0 },
      ),
    ).rejects.toBeUndefined();
    expect(calls).toBe(0);
  });
});
