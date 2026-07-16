// DH-0089: produces the display-only `inputSummary` field carried on the `tool_call` SSE
// event (src/contracts/events.ts). Never the full arguments — the JSONL log's `tool_call`
// line (already redacted per DH-0020) is the durable, complete record; this exists solely to
// drive a compact "agent is running X" live indicator in the TUI/Web transcript.
//
// The priority-key list below is an internal heuristic Core may evolve freely without a
// contracts change — the wire contract (ToolCallEvent.inputSummary) only promises
// "single-line, display-only, <= TOOL_INPUT_SUMMARY_MAX_CHARS chars".

/** Wire contract's max length for `ToolCallEvent.inputSummary` (truncated with a trailing
 * "…" beyond this). */
export const TOOL_INPUT_SUMMARY_MAX_CHARS = 200;

const PRIORITY_KEYS = [
  "command",
  "file_path",
  "path",
  "url",
  "query",
  "prompt",
  "description",
  "name",
  "skill",
] as const;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string): string {
  if (value.length <= TOOL_INPUT_SUMMARY_MAX_CHARS) {
    return value;
  }
  return `${value.slice(0, TOOL_INPUT_SUMMARY_MAX_CHARS)}…`;
}

/**
 * Heuristic: first present string value among `PRIORITY_KEYS`; else the first string-valued
 * property (in object key-enumeration order); else a compact `JSON.stringify(input)`. The
 * `toolName` argument isn't currently consulted by the heuristic (it's uniform across tools)
 * but is part of the signature per the design so future per-tool special-casing doesn't
 * require a call-site change.
 */
export function summarizeToolInput(_toolName: string, input: unknown): string {
  let raw: string;

  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    let picked: string | undefined;

    for (const key of PRIORITY_KEYS) {
      const value = record[key];
      if (typeof value === "string") {
        picked = value;
        break;
      }
    }

    if (picked === undefined) {
      for (const value of Object.values(record)) {
        if (typeof value === "string") {
          picked = value;
          break;
        }
      }
    }

    raw = picked !== undefined ? picked : JSON.stringify(input);
  } else {
    raw = JSON.stringify(input);
  }

  return truncate(collapseWhitespace(raw));
}
