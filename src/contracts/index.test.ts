import { describe, expect, test } from "bun:test";
import * as contracts from "./index.ts";

// Bun's coverage tool only tracks files a test actually loads (directly or
// transitively) — an untested src/ file is silently omitted from the report
// rather than shown at 0%. This import makes the barrel (and everything it
// re-exports) show up in coverage at all, closing that gap for the
// otherwise-untested type-only modules (commands/config/events/log).
describe("contracts barrel", () => {
  test("re-exports the wire-truth modules", () => {
    expect(contracts.ExitCode.Success).toBe(0);
    expect(contracts.ExitCode.TaskFailure).toBe(1);
    expect(contracts.ExitCode.HarnessError).toBe(2);
  });
});
