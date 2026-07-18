// Pure slash-command parsing (DH-0093 design §1). Deliberately a byte-for-byte mirror of
// `src/tui/commands.ts`'s grammar — the design doc calls for a shared parser where practical,
// but the TUI/Web domain boundary (CLAUDE.md §3: each client owns its own module tree) makes
// a literal shared module awkward here, so this is the acceptable fallback noted in the
// ticket: two independent implementations verified against the same test-vector table (the
// `describe.each`-style vectors in commands.test.ts match `src/tui/commands.test.ts`'s).
//
// Grammar: any input matching `^/\S` is a command attempt. `name` is the run of non-space
// characters right after the slash; `args` is everything after the first run of whitespace,
// verbatim (can carry embedded newlines). A bare `/` or `/ ` (slash-space) is ordinary chat.

export interface ParsedSlashCommand {
  name: string;
  args: string;
}

const SLASH_COMMAND_RE = Object.freeze(/^\/(\S+)(?:\s+([\s\S]*))?$/);

export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const match = SLASH_COMMAND_RE.exec(input);
  if (!match) return null;
  const name = match[1];
  if (!name) return null;
  return { name, args: match[2] ?? "" };
}

/** Built-in command names — shadow any same-named skill (design §4). */
export const BUILTIN_COMMAND_NAMES = ["model", "help", "clear"] as const;
export type BuiltinCommandName = (typeof BUILTIN_COMMAND_NAMES)[number];

export function isBuiltinCommandName(name: string): name is BuiltinCommandName {
  return (BUILTIN_COMMAND_NAMES as readonly string[]).includes(name);
}
