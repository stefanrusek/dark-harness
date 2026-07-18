// Resolves `$(VAR)` in any string value against process.env at load time (HANDOFF.md §5).
// Applied recursively across the whole parsed config tree before validation.
//
// DH-0015 fix (tracking/DH-0015-config-validation-gaps.md): `$(VAR)` had no escape mechanism —
// a literal `$(...)`-shaped string (meant for a subprocess a Bash-tool call runs, not for `dh`
// itself) was always either interpolated or, if the referenced name happened not to be a real
// env var, errored outright. `$$(...)` now escapes to a literal `$(...)` (the `$$` collapses
// to a single `$`, and the parenthesized text is left untouched, never looked up as a var
// name) — a operator writing a literal `$$(FOO)` in dh.json gets `$(FOO)` in the loaded config,
// with no env lookup attempted.

// Matches `$$(...)` (escape) or `$(VAR)` (real reference) in one pass so escape sequences are
// resolved without a lookbehind (Bun's V8 supports it, but keeping this simple/portable) and
// without the escape's own `$` being mistaken for the start of a following `$(VAR)`.
// biome-ignore lint/plugin: RegExp with a g/y flag mutates its own lastIndex during matching; Object.freeze() would break that (DH-0162).
const TOKEN_PATTERN = /\$(\$)?\(([A-Za-z_][A-Za-z0-9_]*)\)/g;

export function interpolateString(value: string, env: Record<string, string | undefined>): string {
  return value.replace(TOKEN_PATTERN, (_whole, escaped: string | undefined, varName: string) => {
    if (escaped) {
      // `$$(NAME)` -> literal `$(NAME)`, no env lookup.
      return `$(${varName})`;
    }
    const resolved = env[varName];
    if (resolved === undefined) {
      throw new Error(`environment variable "${varName}" referenced by $(${varName}) is not set`);
    }
    return resolved;
  });
}

/** Recursively walks a parsed JSON value, interpolating every string it finds. */
export function interpolateDeep<T>(value: T, env: Record<string, string | undefined>): T {
  if (typeof value === "string") {
    return interpolateString(value, env) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateDeep(item, env)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = interpolateDeep(val, env);
    }
    return result as T;
  }
  return value;
}
