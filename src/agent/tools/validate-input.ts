// Shared tool-input validation helper (DH-0172) — driven by a tool's own declared
// `inputSchema` (JsonSchema, see types.type.ts) instead of each tool hand-rolling
// `typeof input.x !== "string"` boilerplate with its own copy of the error-message text.
//
// This is deliberately NOT a general JSON Schema validator: it covers exactly the shapes
// actually used across src/agent/tools/*.ts — required/optional string (non-empty when
// required, matching the pre-existing "must be a non-empty string" convention), number,
// boolean, array (including `items: { type: "string" }` array-of-strings), and object.
// Anything a tool needs beyond plain type/required-shape checking (mutual exclusivity,
// enum membership, semantic checks needing ctx, nested/complex shapes) stays as local
// hand-written code in that tool's execute(), run *after* this helper's check.

import type { JsonSchema, ToolResult } from "./types.type.ts";

export type ValidationOutcome = { ok: true } | { ok: false; result: ToolResult };

function toolError(toolName: string, field: string, message: string): ValidationOutcome {
  return {
    ok: false,
    result: { output: `${toolName} tool error: '${field}' ${message}`, isError: true },
  };
}

/** Property-level JSON Schema subset this helper understands — a superset of what any one
 * tool's inputSchema property needs, per the JsonSchema interface's `properties` being
 * typed `Record<string, unknown>` (untyped at the top level). */
interface PropertySchema {
  type?: string;
  items?: { type?: string };
}

function validateProperty(
  toolName: string,
  field: string,
  propSchema: PropertySchema,
  value: unknown,
  required: boolean,
): ValidationOutcome {
  switch (propSchema.type) {
    case "string": {
      if (typeof value !== "string" || (required && value.length === 0)) {
        const message = required ? "must be a non-empty string." : "must be a string.";
        return toolError(toolName, field, message);
      }
      return { ok: true };
    }
    case "number":
    case "integer": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return toolError(toolName, field, "must be a number.");
      }
      return { ok: true };
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        return toolError(toolName, field, "must be a boolean.");
      }
      return { ok: true };
    }
    case "array": {
      const itemType = propSchema.items?.type;
      const isArray = Array.isArray(value);
      const itemsOk =
        isArray && (itemType !== "string" || value.every((v) => typeof v === "string"));
      if (!itemsOk) {
        const message =
          itemType === "string" ? "must be an array of strings." : "must be an array.";
        return toolError(toolName, field, message);
      }
      return { ok: true };
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return toolError(toolName, field, "must be an object.");
      }
      return { ok: true };
    }
    default:
      // Unknown/unhandled schema type (e.g. no `type` at all) — nothing this mini-validator
      // can check; leave it to the tool's own local logic.
      return { ok: true };
  }
}

/**
 * Validates `input` against `inputSchema`'s declared `properties`/`required`, producing the
 * canonical `"<ToolName> tool error: '<field>' ...` ` message on the first failure found (in
 * schema property-declaration order). Call sites do:
 *
 * ```ts
 * const v = validateInput(someTool.inputSchema, "SomeTool", input);
 * if (!v.ok) return v.result;
 * ```
 *
 * and then keep any tool-specific semantic checks (enum membership, mutual exclusivity,
 * checks needing `ctx`) as local code after this call.
 */
export function validateInput(
  inputSchema: JsonSchema,
  toolName: string,
  input: Record<string, unknown>,
): ValidationOutcome {
  const required = new Set(inputSchema.required ?? []);
  for (const [field, rawPropSchema] of Object.entries(inputSchema.properties)) {
    const value = input[field];
    const isRequired = required.has(field);
    if (value === undefined) {
      if (isRequired) return toolError(toolName, field, "is required.");
      continue;
    }
    const outcome = validateProperty(
      toolName,
      field,
      rawPropSchema as PropertySchema,
      value,
      isRequired,
    );
    if (!outcome.ok) return outcome;
  }
  return { ok: true };
}
