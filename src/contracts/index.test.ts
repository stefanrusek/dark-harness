import { describe, expect, test } from "bun:test";
import * as contracts from "./index.ts";

// DH-0155 sub-wave 1A: commands/config/events/log were renamed to .type.ts and exit-codes to
// .constant.ts, so DH-0152's coverage-exclusion mechanism now skips them from the coverage
// report entirely — the fake-import-for-coverage-registration workaround this test used to
// need (see prior revision) is no longer necessary. This just re-checks the barrel actually
// re-exports the one runtime value left among these six files.
describe("contracts barrel", () => {
  test("re-exports the wire-truth modules", () => {
    expect(contracts.ExitCode.Success).toBe(0);
    expect(contracts.ExitCode.TaskFailure).toBe(1);
    expect(contracts.ExitCode.HarnessError).toBe(2);
  });
});
