import { describe, expect, test } from "bun:test";
import type { JsonSchema } from "./types.type.ts";
import { validateInput } from "./validate-input.ts";

describe("validateInput", () => {
  test("passes when required and optional fields are present and well-typed", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        nickname: { type: "string" },
      },
      required: ["name"],
    };
    const result = validateInput(schema, "Thing", { name: "a", nickname: "b" });
    expect(result.ok).toBe(true);
  });

  test("passes when only required fields are present", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    expect(validateInput(schema, "Thing", { name: "a" }).ok).toBe(true);
  });

  test("passes for a schema with no required list at all", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { name: { type: "string" } },
    };
    expect(validateInput(schema, "Thing", {}).ok).toBe(true);
  });

  test("rejects a missing required field with 'is required.'", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    const result = validateInput(schema, "Thing", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result).toEqual({
        output: "Thing tool error: 'name' is required.",
        isError: true,
      });
    }
  });

  test("rejects a required string that is empty", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    const result = validateInput(schema, "Thing", { name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.output).toBe("Thing tool error: 'name' must be a non-empty string.");
    }
  });

  test("rejects a required field of the wrong type", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    const result = validateInput(schema, "Thing", { name: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.output).toBe("Thing tool error: 'name' must be a non-empty string.");
    }
  });

  test("allows an optional string field to be empty", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { nickname: { type: "string" } },
    };
    expect(validateInput(schema, "Thing", { nickname: "" }).ok).toBe(true);
  });

  test("rejects an optional field of the wrong type with 'must be a string.'", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { nickname: { type: "string" } },
    };
    const result = validateInput(schema, "Thing", { nickname: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.output).toBe("Thing tool error: 'nickname' must be a string.");
    }
  });

  test("skips an omitted optional field entirely", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { nickname: { type: "string" }, count: { type: "number" } },
    };
    expect(validateInput(schema, "Thing", { count: 1 }).ok).toBe(true);
  });

  test("accepts a valid number field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { count: { type: "number" } },
    };
    expect(validateInput(schema, "Thing", { count: 42 }).ok).toBe(true);
  });

  test("accepts a valid integer-typed field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { count: { type: "integer" } },
    };
    expect(validateInput(schema, "Thing", { count: 42 }).ok).toBe(true);
  });

  test("rejects a non-number value for a number field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { count: { type: "number" } },
    };
    const result = validateInput(schema, "Thing", { count: "5" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.output).toBe("Thing tool error: 'count' must be a number.");
    }
  });

  test("rejects NaN for a number field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { count: { type: "number" } },
    };
    const result = validateInput(schema, "Thing", { count: Number.NaN });
    expect(result.ok).toBe(false);
  });

  test("accepts a valid boolean field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { flag: { type: "boolean" } },
    };
    expect(validateInput(schema, "Thing", { flag: false }).ok).toBe(true);
  });

  test("rejects a non-boolean value for a boolean field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { flag: { type: "boolean" } },
    };
    const result = validateInput(schema, "Thing", { flag: "yes" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.output).toBe("Thing tool error: 'flag' must be a boolean.");
    }
  });

  test("accepts a valid array-of-strings field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } } },
    };
    expect(validateInput(schema, "Thing", { tags: ["a", "b"] }).ok).toBe(true);
    expect(validateInput(schema, "Thing", { tags: [] }).ok).toBe(true);
  });

  test("rejects a non-array value for an array-of-strings field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } } },
    };
    const result = validateInput(schema, "Thing", { tags: "a" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.output).toBe("Thing tool error: 'tags' must be an array of strings.");
    }
  });

  test("rejects an array with a non-string element for an array-of-strings field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } } },
    };
    const result = validateInput(schema, "Thing", { tags: ["a", 1] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.output).toBe("Thing tool error: 'tags' must be an array of strings.");
    }
  });

  test("rejects a non-array value for a plain array field (no items.type)", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { items: { type: "array" } },
    };
    const result = validateInput(schema, "Thing", { items: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.output).toBe("Thing tool error: 'items' must be an array.");
    }
  });

  test("accepts a plain array field with non-string items when items.type is unset", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { items: { type: "array" } },
    };
    expect(validateInput(schema, "Thing", { items: [1, 2, "x"] }).ok).toBe(true);
  });

  test("accepts a valid object field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { meta: { type: "object" } },
    };
    expect(validateInput(schema, "Thing", { meta: { a: 1 } }).ok).toBe(true);
  });

  test("rejects a non-object value for an object field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { meta: { type: "object" } },
    };
    expect(validateInput(schema, "Thing", { meta: "x" }).ok).toBe(false);
  });

  test("rejects null for an object field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { meta: { type: "object" } },
    };
    const result = validateInput(schema, "Thing", { meta: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.output).toBe("Thing tool error: 'meta' must be an object.");
    }
  });

  test("rejects an array for an object field", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { meta: { type: "object" } },
    };
    expect(validateInput(schema, "Thing", { meta: [1, 2] }).ok).toBe(false);
  });

  test("ignores a property with no recognized 'type', leaving it to local logic", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { anything: {} },
    };
    expect(validateInput(schema, "Thing", { anything: Symbol("x") }).ok).toBe(true);
  });

  test("stops at the first invalid field, in property-declaration order", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        first: { type: "string" },
        second: { type: "string" },
      },
      required: ["first", "second"],
    };
    const result = validateInput(schema, "Thing", {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.result.output).toBe("Thing tool error: 'first' is required.");
    }
  });
});
