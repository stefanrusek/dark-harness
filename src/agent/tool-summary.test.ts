import { describe, expect, test } from "bun:test";
import { TOOL_INPUT_SUMMARY_MAX_CHARS, summarizeToolInput } from "./tool-summary.ts";

describe("summarizeToolInput", () => {
  test("picks the first present priority key, in priority order", () => {
    expect(summarizeToolInput("Bash", { command: "bun test", description: "run tests" })).toBe(
      "bun test",
    );
    expect(summarizeToolInput("Read", { file_path: "/tmp/foo.ts" })).toBe("/tmp/foo.ts");
    expect(summarizeToolInput("Read", { path: "/tmp/bar.ts" })).toBe("/tmp/bar.ts");
    expect(summarizeToolInput("WebFetch", { url: "https://example.com" })).toBe(
      "https://example.com",
    );
    expect(summarizeToolInput("Search", { query: "foo bar" })).toBe("foo bar");
    expect(summarizeToolInput("Agent", { prompt: "do the thing" })).toBe("do the thing");
    expect(summarizeToolInput("Agent", { description: "spawn worker" })).toBe("spawn worker");
    expect(summarizeToolInput("Skill", { name: "sm" })).toBe("sm");
    expect(summarizeToolInput("Skill", { skill: "sugarmaple" })).toBe("sugarmaple");
  });

  test("priority keys are checked in the documented order, not object key order", () => {
    // `path` appears before `command` in the object, but `command` outranks it.
    expect(summarizeToolInput("Bash", { path: "/tmp", command: "ls" })).toBe("ls");
  });

  test("falls back to the first string-valued property when no priority key matches", () => {
    expect(summarizeToolInput("Custom", { count: 3, label: "hello" })).toBe("hello");
  });

  test("falls back to compact JSON.stringify when there is no string-valued property at all", () => {
    expect(summarizeToolInput("Custom", { count: 3, ok: true })).toBe('{"count":3,"ok":true}');
  });

  test("handles non-object input (array or primitive) via JSON.stringify", () => {
    expect(summarizeToolInput("Custom", ["a", "b"])).toBe('["a","b"]');
    expect(summarizeToolInput("Custom", "just a string")).toBe('"just a string"');
    expect(summarizeToolInput("Custom", null)).toBe("null");
  });

  test("collapses whitespace runs (including newlines) to single spaces", () => {
    expect(summarizeToolInput("Bash", { command: "echo hi\n\n  there\tworld" })).toBe(
      "echo hi there world",
    );
  });

  test("truncates to TOOL_INPUT_SUMMARY_MAX_CHARS with a trailing ellipsis", () => {
    const long = "x".repeat(TOOL_INPUT_SUMMARY_MAX_CHARS + 50);
    const result = summarizeToolInput("Bash", { command: long });
    expect(result.length).toBe(TOOL_INPUT_SUMMARY_MAX_CHARS + 1);
    expect(result.endsWith("…")).toBe(true);
    expect(result.startsWith("x".repeat(TOOL_INPUT_SUMMARY_MAX_CHARS))).toBe(true);
  });

  test("does not truncate a string exactly at the max length", () => {
    const exact = "y".repeat(TOOL_INPUT_SUMMARY_MAX_CHARS);
    expect(summarizeToolInput("Bash", { command: exact })).toBe(exact);
  });
});
