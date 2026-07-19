// Pure slash-command parsing (DH-0093 design §1). Shared by the TUI and Web clients — DH-0183
// consolidated this out of `src/tui/commands.ts` and `src/web/client/slash-commands.ts`, which
// had been two byte-identical, zero-DOM/terminal-coupled implementations kept apart under a
// domain-boundary excuse that DH-0170's architect review judged too weak to justify the
// duplication. Kept as its own tiny module — like the rest of `src/client-core/` — so callers
// never have to know regex details, and so this exact grammar can be unit-tested in isolation.
//
// Grammar (from the ticket's architect design, matching observed real-Claude-Code behavior):
// any input matching `^/\S` is a command attempt, `name` is the run of non-space characters
// right after the slash, `args` is everything after the first run of whitespace (verbatim,
// not re-split). Input starting with `/ ` (slash-space) or a bare `/` alone does NOT match —
// both are ordinary chat text, since there's no command name immediately after the slash.

export interface ParsedSlashCommand {
  name: string;
  args: string;
}

// `[\s\S]*` (not `.*`) so `args` can carry embedded newlines (e.g. a bracketed-paste that
// happens to start with a slash command) without `.`'s no-newline limitation truncating it.
const SLASH_COMMAND_RE = Object.freeze(/^\/(\S+)(?:\s+([\s\S]*))?$/);

export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const match = SLASH_COMMAND_RE.exec(input);
  if (!match) return null;
  const name = match[1];
  if (!name) return null;
  return { name, args: match[2] ?? "" };
}

/** Built-in command names — shadow any same-named skill (DH-0093 design §4: "Built-in names
 * (model, help, clear) shadow same-named skills"). */
export const BUILTIN_COMMAND_NAMES = ["model", "help", "clear"] as const;
export type BuiltinCommandName = (typeof BUILTIN_COMMAND_NAMES)[number];

export function isBuiltinCommandName(name: string): name is BuiltinCommandName {
  return (BUILTIN_COMMAND_NAMES as readonly string[]).includes(name);
}
