// DH-0173: extracted from AgentRuntime — session-wide cumulative cost/token/wall-clock
// budget bookkeeping (DH-0013, tracking/DH-0013-no-cost-turn-time-or-fanout-budgets.md).
// Behavior-preserving extraction: the tripping/reporting logic itself still lives in
// AgentRuntime (it needs to reach across root + every sub-agent task, which only the
// runtime sees), but the pure "how much have we spent, have we crossed a configured cap"
// state and math now lives here so it's unit-testable without spinning up a whole runtime.

import type { DhConfig } from "../contracts/index.ts";

export interface SessionBudgetOptions {
  maxCostUsd: number | undefined;
  maxTotalTokens: number | undefined;
  maxWallClockMs: number | undefined;
}

/** Result of `recordUsage()`: which (if either) configured cap was just crossed by this
 * usage report, expressed as a human-readable reason string ready to log/report — or
 * `undefined` if no cap was crossed (including the case where the budget was already
 * tripped, in which case `recordUsage()` is a no-op). */
export type BudgetTripReason = string | undefined;

export function sessionBudgetOptionsFromConfig(config: DhConfig): SessionBudgetOptions {
  return {
    maxCostUsd: config.options.maxCostUsd,
    maxTotalTokens: config.options.maxTotalTokens,
    maxWallClockMs: config.options.maxWallClockMs,
  };
}

/** Tracks cumulative cost/token usage across a whole session (root + every sub-agent) and
 * reports when a configured `options.max*` cap has just been crossed. Does not itself stop
 * any agent — the caller (AgentRuntime) owns reacting to a trip (logging + stopping every
 * live agent), since only it has the agent tree/task registry needed to do that. */
export class SessionBudget {
  private cumulativeCostUsd = 0;
  private cumulativeTokens = 0;
  private tripped = false;

  constructor(private readonly options: SessionBudgetOptions) {}

  get isTripped(): boolean {
    return this.tripped;
  }

  /** Marks the budget tripped without going through `recordUsage()` — used by the wall-clock
   * timer path, which has no usage numbers of its own to report. Idempotent. */
  markTripped(): void {
    this.tripped = true;
  }

  /** DH-0013: records a `token_usage` event's contribution to the cumulative cost/token
   * budgets and reports if either configured cap was just crossed.
   *
   * DH-0010 Part A fix: the cumulative token count must include cache-read/cache-write
   * tokens, not just input+output — otherwise enabling caching would silently inflate
   * `maxTotalTokens`'s effective budget (cache tokens are real provider-reported usage, just
   * priced/reported separately). */
  recordUsage(
    inputTokens: number,
    outputTokens: number,
    costUsd: number | undefined,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
  ): BudgetTripReason {
    if (this.tripped) return undefined;
    this.cumulativeTokens += inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
    if (costUsd !== undefined) this.cumulativeCostUsd += costUsd;

    const { maxCostUsd, maxTotalTokens } = this.options;
    if (maxCostUsd !== undefined && this.cumulativeCostUsd >= maxCostUsd) {
      this.tripped = true;
      return `cumulative cost $${this.cumulativeCostUsd.toFixed(4)} reached configured options.maxCostUsd ($${maxCostUsd})`;
    }
    if (maxTotalTokens !== undefined && this.cumulativeTokens >= maxTotalTokens) {
      this.tripped = true;
      return `cumulative tokens ${this.cumulativeTokens} reached configured options.maxTotalTokens (${maxTotalTokens})`;
    }
    return undefined;
  }
}
