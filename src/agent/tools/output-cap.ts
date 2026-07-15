// Shared output cap — Round 13 (docs/handoffs/core.md, P1 item 1): real Claude Code caps
// what a Bash-shaped tool returns to the model (~30,000 chars) with a truncation notice
// naming the true total size; `dh` previously buffered and returned everything unbounded.
// Shared between Bash's own foreground return and TaskOutput (which is the only other place
// task/bash output reaches the model) so the cap applies consistently regardless of which
// path a caller took to see a command's output.

export const OUTPUT_CAP_CHARS = 30_000;

export interface CappedOutput {
  text: string;
  truncated: boolean;
  totalLength: number;
}

/** Caps `text` to at most `capChars`, keeping the tail (the most recent / most relevant
 * output for a long-running command) and prepending a notice stating the true total size
 * when truncation occurred. Kept as a pure function so it's trivially unit-testable without
 * spinning up a real subprocess. */
export function capOutput(text: string, capChars: number = OUTPUT_CAP_CHARS): CappedOutput {
  if (text.length <= capChars) {
    return { text, truncated: false, totalLength: text.length };
  }
  const kept = text.slice(text.length - capChars);
  const notice = `[output truncated: showing last ${capChars} of ${text.length} total chars]\n`;
  return { text: `${notice}${kept}`, truncated: true, totalLength: text.length };
}
