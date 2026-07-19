import { describe, expect, test } from "bun:test";
import { isContextOverflowMessage, mapStopReason, withCacheMarkers } from "./shared.ts";

describe("mapStopReason", () => {
  test("maps the known raw reasons", () => {
    expect(mapStopReason("tool_use")).toBe("tool_use");
    expect(mapStopReason("max_tokens")).toBe("max_tokens");
    expect(mapStopReason("end_turn")).toBe("end_turn");
  });

  test("falls back to other for unrecognized/absent reasons", () => {
    expect(mapStopReason("stop_sequence")).toBe("other");
    expect(mapStopReason(null)).toBe("other");
    expect(mapStopReason(undefined)).toBe("other");
  });
});

describe("isContextOverflowMessage", () => {
  test("matches against the supplied pattern", () => {
    expect(isContextOverflowMessage("Prompt is too long for model", /prompt is too long/i)).toBe(
      true,
    );
    expect(isContextOverflowMessage("input is too long: 500000 tokens", /input is too long/i)).toBe(
      true,
    );
  });

  test("returns false when the pattern doesn't match", () => {
    expect(isContextOverflowMessage("rate limited", /prompt is too long/i)).toBe(false);
  });
});

describe("withCacheMarkers", () => {
  test("marks the last message only when there's a single message", () => {
    const messages = [{ role: "user" as const, content: ["a"] }];
    const marked = withCacheMarkers(messages, (content) => [...content, "MARK"]);
    expect(marked).toEqual([{ role: "user", content: ["a", "MARK"] }]);
    // Input untouched.
    expect(messages[0]?.content).toEqual(["a"]);
  });

  test("marks the last message and the second-to-last user message", () => {
    const messages = [
      { role: "user" as const, content: ["u1"] },
      { role: "assistant" as const, content: ["a1"] },
      { role: "user" as const, content: ["u2"] },
      { role: "assistant" as const, content: ["a2"] },
    ];
    const marked = withCacheMarkers(messages, (content) => [...content, "MARK"]);
    expect(marked).toEqual([
      { role: "user", content: ["u1", "MARK"] },
      { role: "assistant", content: ["a1"] },
      { role: "user", content: ["u2"] },
      { role: "assistant", content: ["a2", "MARK"] },
    ]);
  });

  test("no-ops safely on an empty message list", () => {
    expect(withCacheMarkers([], (content) => [...content, "MARK"])).toEqual([]);
  });

  test("never mutates the caller's original message/content arrays", () => {
    const original = [{ role: "user" as const, content: ["a"] }];
    withCacheMarkers(original, (content) => {
      content.push("MUTATED");
      return content;
    });
    expect(original[0]?.content).toEqual(["a"]);
  });
});
