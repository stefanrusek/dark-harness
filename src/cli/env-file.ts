// DH-0174 (Core, extracted from cli.ts): `--env <file>` dotenv-subset parser.
import { ConfigError } from "../config/index.ts";

/** Resolves `\"`, `\\`, `\n`, `\t` escapes inside a double-quoted value's content — the only
 * quoting style that gets escape processing (DH-0015: single-quoted values are deliberately
 * literal, see parseEnvFile's own doc comment). */
function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\(["\\nt])/g, (_whole, ch: string) => {
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    return ch; // \" -> ", \\ -> \
  });
}

/**
 * Parses a dotenv-style file — a deliberately minimal, documented subset (README.md's
 * "Keeping secrets out of dh.json" section states this exact behavior for operators), not a
 * reimplementation of any particular dotenv tool's full dialect:
 *
 * - `KEY=VALUE` per line; blank lines and lines starting with `#` (after trimming leading
 *   whitespace) are skipped as comments. `#` is NOT an inline/trailing comment marker within
 *   a value — DH-0015 fix: previously undocumented and easy to get wrong by assuming common
 *   dotenv-tool behavior; a value containing `#` is always taken literally, in full.
 * - A double-quoted value (`"..."`) has its surrounding quotes stripped, with `\"`, `\\`,
 *   `\n`, `\t` escapes resolved inside it — DH-0015 fix: previously quotes were stripped with
 *   zero escape processing, so there was no way to express a literal embedded `"` or a newline.
 * - A single-quoted value (`'...'`) — DH-0015 addition — has its surrounding quotes stripped
 *   with NO escape processing at all: the one way to express a value containing a literal `#`,
 *   backslash, or double-quote without needing to escape anything.
 * - An unquoted value is used as-is (after trimming surrounding whitespace).
 *
 * Pure function — throws a clear error naming the offending line for anything without an `=`.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`malformed env file line ${i + 1}: expected KEY=VALUE, got "${line}"`);
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = unescapeDoubleQuoted(value.slice(1, -1));
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export async function readEnvFile(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new ConfigError(`env file not found: ${path}`);
  }
  return file.text();
}
