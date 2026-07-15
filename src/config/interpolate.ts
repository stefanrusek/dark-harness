// Resolves `$(VAR)` in any string value against process.env at load time (HANDOFF.md §5).
// Applied recursively across the whole parsed config tree before validation.

const VAR_PATTERN = /\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g;

export function interpolateString(value: string, env: Record<string, string | undefined>): string {
  return value.replace(VAR_PATTERN, (whole, varName: string) => {
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
