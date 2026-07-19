// DH-0221: resolves the terminal's supported color depth from injected inputs. Impure in
// principle (the values ultimately come from process.env/process.stdout.isTTY) but pure in
// practice — this function itself never touches `process`, so it stays unit-testable without
// global mutation. Kept out of src/design-tokens.ts (documented pure/no-process) per this
// ticket's architecture decision; the CLI entry point passes the real values in at startup.
import type { ColorLevel } from "../design-tokens.ts";

export interface ColorLevelInputs {
  /** `process.stdout.isTTY === true` */
  isTTY: boolean;
  /** `process.env` */
  env: Record<string, string | undefined>;
  /** Parsed `--plain` flag */
  plain: boolean;
}

/** Resolve color depth. Precedence: --plain / NO_COLOR / non-TTY force "none"; COLORTERM in
 * {truecolor,24bit} -> "truecolor"; else "ansi256".
 *
 * NO_COLOR is honored per the informal standard (https://no-color.org/): *presence* disables
 * color regardless of its value, so `NO_COLOR=""` and `NO_COLOR="0"` both disable — only an
 * altogether-unset NO_COLOR leaves color enabled.
 *
 * No FORCE_COLOR handling — out of scope for this ticket; add only if a real need appears. */
export function detectColorLevel(inp: ColorLevelInputs): ColorLevel {
  if (inp.plain || inp.env.NO_COLOR !== undefined || !inp.isTTY) {
    return "none";
  }
  const colorterm = inp.env.COLORTERM;
  if (colorterm === "truecolor" || colorterm === "24bit") {
    return "truecolor";
  }
  return "ansi256";
}
