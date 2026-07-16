import { describe, expect, test } from "bun:test";
import { REPORT_OUTCOME_TOOL_NAME } from "../../contracts/index.ts";
import { parseReportedOutcome, reportOutcomeTool } from "./report-outcome.ts";
import { makeToolContext } from "./test-helpers.ts";

describe("parseReportedOutcome", () => {
  test("a minimal valid call (status only) parses", () => {
    expect(parseReportedOutcome({ status: "success" })).toEqual({ status: "success" });
    expect(parseReportedOutcome({ status: "failure" })).toEqual({ status: "failure" });
  });

  test("a fully-populated valid call carries every optional field through", () => {
    expect(
      parseReportedOutcome({
        status: "success",
        summary: "did the thing",
        filesChanged: ["a.ts", "b.ts"],
        artifacts: ["https://example.com/report.pdf"],
      }),
    ).toEqual({
      status: "success",
      summary: "did the thing",
      filesChanged: ["a.ts", "b.ts"],
      artifacts: ["https://example.com/report.pdf"],
    });
  });

  test("an invalid status returns null — the one load-bearing field", () => {
    expect(parseReportedOutcome({ status: "maybe" })).toBeNull();
    expect(parseReportedOutcome({ status: undefined })).toBeNull();
    expect(parseReportedOutcome({})).toBeNull();
  });

  test("non-object/null input returns null without throwing", () => {
    expect(parseReportedOutcome(null)).toBeNull();
    expect(parseReportedOutcome(undefined)).toBeNull();
    expect(parseReportedOutcome("success")).toBeNull();
    expect(parseReportedOutcome(42)).toBeNull();
  });

  // "Garbled payloads degrade gracefully" (the ticket's design argument): a malformed
  // optional field is dropped, not treated as invalidating the whole call — only `status`
  // is load-bearing for control flow.
  test("a garbled optional field is dropped, not treated as invalidating the whole call", () => {
    expect(
      parseReportedOutcome({
        status: "success",
        summary: 42, // wrong type — dropped
        filesChanged: "not-an-array", // wrong type — dropped
        artifacts: ["ok.txt", 7], // mixed-type array — dropped entirely
      }),
    ).toEqual({ status: "success" });
  });
});

describe("reportOutcomeTool", () => {
  test("has the shared contract's tool name", () => {
    expect(reportOutcomeTool.name).toBe(REPORT_OUTCOME_TOOL_NAME);
    expect(reportOutcomeTool.name).toBe("ReportOutcome");
  });

  test("declares status as the only required input", () => {
    expect(reportOutcomeTool.inputSchema.required).toEqual(["status"]);
  });

  test("execute() with a valid status acknowledges and is never an error", async () => {
    const ctx = makeToolContext();
    const result = await reportOutcomeTool.execute({ status: "success" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("Outcome recorded");

    const failureResult = await reportOutcomeTool.execute({ status: "failure" }, ctx);
    expect(failureResult.isError).toBe(false);
  });

  test("execute() with an invalid status is a corrective error, not a crash", async () => {
    const ctx = makeToolContext();
    const result = await reportOutcomeTool.execute({ status: "not-a-real-status" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("ReportOutcome tool error");
    expect(result.output).toContain("success");
    expect(result.output).toContain("failure");
  });

  test("execute() has no side effects on the ToolContext — the loop is the authority", async () => {
    const ctx = makeToolContext();
    const before = { ...ctx };
    await reportOutcomeTool.execute({ status: "success" }, ctx);
    // Nothing on the shared context (tasks, todos, activatedTools, readRegistry) was touched.
    expect(ctx.tasks).toBe(before.tasks);
    expect(ctx.todos).toBe(before.todos);
    expect(ctx.activatedTools.size).toBe(0);
    expect(ctx.readRegistry.size).toBe(0);
  });
});
