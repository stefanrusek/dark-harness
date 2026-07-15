import { describe, expect, test } from "bun:test";
import {
  agentStatusStyle,
  connectionStatusLabel,
  formatCostUsd,
  formatExitCode,
  formatTokenCount,
  shortAgentId,
  suggestedLogFilename,
} from "./format.ts";

describe("agentStatusStyle", () => {
  test("maps every AgentStatus to a distinct label and token", () => {
    expect(agentStatusStyle("running")).toEqual({ label: "Running", token: "running" });
    expect(agentStatusStyle("waiting")).toEqual({ label: "Waiting", token: "waiting" });
    expect(agentStatusStyle("done")).toEqual({ label: "Done", token: "done" });
    expect(agentStatusStyle("failed")).toEqual({ label: "Failed", token: "failed" });
    expect(agentStatusStyle("stopped")).toEqual({ label: "Stopped", token: "stopped" });
  });
});

describe("connectionStatusLabel", () => {
  test("has a human label for every ConnectionStatus", () => {
    expect(connectionStatusLabel("connecting")).toBe("Connecting…");
    expect(connectionStatusLabel("open")).toBe("Live");
    expect(connectionStatusLabel("reconnecting")).toBe("Reconnecting…");
    expect(connectionStatusLabel("closed")).toBe("Disconnected");
  });
});

describe("formatTokenCount", () => {
  test("renders sub-1000 counts as plain integers", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(950)).toBe("950");
    expect(formatTokenCount(999.6)).toBe("1000");
  });

  test("renders thousands with one decimal and a k suffix", () => {
    expect(formatTokenCount(12_345)).toBe("12.3k");
    expect(formatTokenCount(1000)).toBe("1.0k");
  });

  test("renders millions with one decimal and an M suffix", () => {
    expect(formatTokenCount(1_234_567)).toBe("1.2M");
  });

  test("handles negative and non-finite input defensively", () => {
    expect(formatTokenCount(-5)).toBe("-5");
    expect(formatTokenCount(Number.NaN)).toBe("0");
    expect(formatTokenCount(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("formatCostUsd", () => {
  test("formats zero distinctly", () => {
    expect(formatCostUsd(0)).toBe("$0.00");
  });

  test("formats sub-cent costs as <$0.01 rather than rounding to zero", () => {
    expect(formatCostUsd(0.004)).toBe("<$0.01");
  });

  test("formats normal costs to two decimals", () => {
    expect(formatCostUsd(1.2345)).toBe("$1.23");
    expect(formatCostUsd(12)).toBe("$12.00");
  });

  test("handles non-finite input defensively", () => {
    expect(formatCostUsd(Number.NaN)).toBe("$0.00");
  });
});

describe("formatExitCode", () => {
  test("labels 0 as success", () => {
    expect(formatExitCode(0)).toBe("success (exit 0)");
  });

  test("labels 1 as self-reported task failure", () => {
    expect(formatExitCode(1)).toBe("task failure (exit 1)");
  });

  test("labels 2+ as a harness error", () => {
    expect(formatExitCode(2)).toBe("harness error (exit 2)");
    expect(formatExitCode(17)).toBe("harness error (exit 17)");
  });
});

describe("shortAgentId", () => {
  test("returns short ids unchanged", () => {
    expect(shortAgentId("abc123")).toBe("abc123");
  });

  test("truncates long ids to an 8-char prefix with an ellipsis", () => {
    expect(shortAgentId("abcdefghijklmnop")).toBe("abcdefgh…");
  });

  test("ids exactly at the 10-char boundary are left unchanged", () => {
    expect(shortAgentId("0123456789")).toBe("0123456789");
  });
});

describe("suggestedLogFilename", () => {
  test("names a single agent's log after its id", () => {
    expect(suggestedLogFilename("agent-42")).toBe("agent-42.jsonl");
  });

  test("names the full-session bundle generically when no agentId is given", () => {
    expect(suggestedLogFilename()).toBe("dh-session-logs.tar.gz");
  });
});
