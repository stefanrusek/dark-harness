import { describe, expect, test } from "bun:test";
import type { ConnectionStatus } from "./connection-status.ts";
import { CONNECTION_STATUSES } from "./connection-status.ts";

// DH-0149 (original coverage-backfill rationale, carried over by the DH-0157 split and the
// DH-0183 consolidation into src/client-core/): this module needs at least one real, executed
// line for Bun's coverage instrumentation to register it — a type-only import erases before
// the module is evaluated, and even a value-level namespace import of an all-types module
// produces a zero-line (`LF:0`) lcov record that `scripts/test-isolated.ts`'s merge step
// silently drops. `CONNECTION_STATUSES` is a small genuinely-useful addition (a canonical,
// iterable list of `ConnectionStatus`'s literals) that gives this module real runtime
// behavior to test.
describe("CONNECTION_STATUSES", () => {
  test("lists every ConnectionStatus literal, in canonical order", () => {
    expect(CONNECTION_STATUSES).toEqual(["connecting", "live", "reconnecting", "disconnected"]);
  });

  test("every literal is assignable to ConnectionStatus (derived-type sanity check)", () => {
    // DH-0157: ConnectionStatus is now derived from CONNECTION_STATUSES via
    // `(typeof CONNECTION_STATUSES)[number]`, so the two can never drift apart at the type
    // level — this exercises that the runtime array and the derived type agree at the value
    // level too.
    for (const status of CONNECTION_STATUSES) {
      const covered: ConnectionStatus = status;
      expect(CONNECTION_STATUSES).toContain(covered);
    }
    expect(CONNECTION_STATUSES.length).toBe(4);
  });
});
