import { describe, expect, test } from "bun:test";
import {
  computeBackoffDelayMs,
  DEFAULT_MAX_RECONNECT_DELAY_MS,
  DEFAULT_RECONNECT_DELAY_MS,
} from "./sse-backoff.ts";

describe("computeBackoffDelayMs", () => {
  test("full jitter at its max makes the exponential growth directly observable", () => {
    // 1st failure: base * 2^0 = 1000. 2nd: base * 2^1 = 2000. 3rd: base * 2^2 = 4000.
    expect(computeBackoffDelayMs(0, 1000, 30_000, () => 1)).toBe(1000);
    expect(computeBackoffDelayMs(1, 1000, 30_000, () => 1)).toBe(2000);
    expect(computeBackoffDelayMs(2, 1000, 30_000, () => 1)).toBe(4000);
  });

  test("delay never exceeds the cap even after many consecutive failures", () => {
    expect(computeBackoffDelayMs(10, 1000, 30_000, () => 1)).toBe(30_000);
  });

  test("jitter scales the delay down when randomImpl returns less than 1", () => {
    expect(computeBackoffDelayMs(0, 1000, 30_000, () => 0.25)).toBe(250);
  });

  test("defaults to the byte-equivalent 1000ms/30000ms constants (DH-0024) when unspecified", () => {
    expect(DEFAULT_RECONNECT_DELAY_MS).toBe(1000);
    expect(DEFAULT_MAX_RECONNECT_DELAY_MS).toBe(30_000);
    expect(computeBackoffDelayMs(0, undefined, undefined, () => 1)).toBe(
      DEFAULT_RECONNECT_DELAY_MS,
    );
  });

  test("defaults randomImpl to Math.random, staying within the capped range", () => {
    const delay = computeBackoffDelayMs(0, 1000, 30_000);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(1000);
  });
});
