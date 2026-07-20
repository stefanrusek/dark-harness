import { describe, expect, test } from "bun:test";
import { ExitCode } from "./exit-codes.constant.ts";

describe("ExitCode", () => {
  test("matches the ADR 0006 contract", () => {
    expect(ExitCode.Success).toBe(0);
    expect(ExitCode.TaskFailure).toBe(1);
    expect(ExitCode.HarnessError).toBe(2);
  });
});
