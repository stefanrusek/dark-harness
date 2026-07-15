import { describe, expect, test } from "bun:test";
import { interpolateDeep, interpolateString } from "./interpolate.ts";

describe("interpolateString", () => {
  test("resolves a single $(VAR) reference", () => {
    expect(interpolateString("hello $(NAME)", { NAME: "world" })).toBe("hello world");
  });

  test("resolves multiple references in one string", () => {
    expect(interpolateString("$(A)-$(B)", { A: "x", B: "y" })).toBe("x-y");
  });

  test("leaves strings without references untouched", () => {
    expect(interpolateString("plain string", {})).toBe("plain string");
  });

  test("throws when the referenced variable is not set", () => {
    expect(() => interpolateString("$(MISSING)", {})).toThrow(/MISSING/);
  });

  test("throws when the referenced variable is set to undefined", () => {
    expect(() => interpolateString("$(UNSET)", { UNSET: undefined })).toThrow(/UNSET/);
  });

  test("DH-0015: $$(...) escapes to a literal $(...), with no env lookup attempted", () => {
    expect(interpolateString("$$(NOT_A_REAL_VAR)", {})).toBe("$(NOT_A_REAL_VAR)");
  });

  test("DH-0015: an escaped token and a real reference can coexist in one string", () => {
    expect(interpolateString("literal $$(FOO) and real $(BAR)", { BAR: "resolved" })).toBe(
      "literal $(FOO) and real resolved",
    );
  });
});

describe("interpolateDeep", () => {
  test("interpolates strings nested in objects and arrays", () => {
    const result = interpolateDeep(
      {
        token: "$(TOKEN)",
        nested: { list: ["$(A)", "literal", { deep: "$(B)" }] },
      },
      { TOKEN: "secret", A: "1", B: "2" },
    );
    expect(result).toEqual({
      token: "secret",
      nested: { list: ["1", "literal", { deep: "2" }] },
    });
  });

  test("passes through non-string primitives unchanged", () => {
    expect(interpolateDeep(42, {})).toBe(42);
    expect(interpolateDeep(true, {})).toBe(true);
    expect(interpolateDeep(null, {})).toBe(null);
  });
});
