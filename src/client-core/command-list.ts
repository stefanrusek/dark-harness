// Shared command-list + filter-matching logic for the TUI (DH-0142) and Web (DH-0143)
// autocomplete dropdowns, plus the DH-0144 merge point for dynamically-fetched skills.
// Only the data structure and pure matching functions live here — the dropdown's rendering
// and keyboard-interaction layer is genuinely per-surface (Ink vs. React) and stays in
// `src/tui/` / `src/web/client/` respectively, per both tickets' Functional Requirements.

import { BUILTIN_COMMAND_NAMES, isBuiltinCommandName } from "./slash-command-parser.ts";

/** One autocompletable command: a name (typed after `/`) plus a short human-readable
 * description shown alongside it in the dropdown. */
export interface CommandEntry {
  name: string;
  description: string;
}

/** Short descriptions for the three built-in commands (DH-0093's `BUILTIN_COMMAND_NAMES`) —
 * kept here rather than alongside the parser since the parser itself never needed
 * human-readable text, only the names. */
const BUILTIN_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  model: "switch the active model",
  help: "show available commands",
  clear: "clear the local transcript view",
});

/** The three built-ins as `CommandEntry`s, in `BUILTIN_COMMAND_NAMES`'s declared order. */
export const BUILTIN_COMMANDS: readonly CommandEntry[] = Object.freeze(
  BUILTIN_COMMAND_NAMES.map((name) => ({ name, description: BUILTIN_DESCRIPTIONS[name] ?? "" })),
);

/** Minimal shape a skill entry needs to be merged in — matches
 * `src/contracts/commands.type.ts`'s `SkillInfo` structurally without importing it, so this
 * module has no wire-type dependency. */
export interface SkillLike {
  name: string;
  description: string;
}

/** Merge the built-ins with a session's fetched skill catalog (DH-0144) into one flat list
 * autocomplete can filter against. Built-in names shadow same-named skills (DH-0093 design
 * §4 — matches the existing `/help`/`/<name>` dispatch precedence in both clients), so a
 * skill sharing a built-in's name is dropped here rather than appearing twice. */
export function buildCommandList(skills: readonly SkillLike[]): CommandEntry[] {
  const skillEntries = skills
    .filter((skill) => !isBuiltinCommandName(skill.name))
    .map((skill) => ({ name: skill.name, description: skill.description }));
  return [...BUILTIN_COMMANDS, ...skillEntries];
}

/** Case-insensitive prefix-filter of `commands` by `query` (the partial name typed so far,
 * without the leading `/`). An empty query matches every command — the "bare `/`" case, per
 * both tickets' first User Story ("matches zero or more recognized commands"). */
export function filterCommands(commands: readonly CommandEntry[], query: string): CommandEntry[] {
  const q = query.toLowerCase();
  return commands.filter((c) => c.name.toLowerCase().startsWith(q));
}

/** Given the composer's raw input, returns the in-progress command-name query to filter
 * against, or `null` if the dropdown isn't relevant right now.
 *
 * - Input not starting with `/` (including empty input): not a command attempt -> `null`.
 * - Input exactly `/`: the bare-slash case -> `""` (matches every command).
 * - Whitespace already typed after the name (args have started): the name is committed and
 *   autocomplete is no longer relevant -> `null`.
 * - Otherwise: the run of non-whitespace characters after `/` -> that string.
 */
export function commandQueryFromInput(input: string): string | null {
  if (!input.startsWith("/")) return null;
  const rest = input.slice(1);
  if (/\s/.test(rest)) return null;
  return rest;
}

/** Convenience wrapper: the live dropdown contents for the given raw composer input, or
 * `null` when the dropdown shouldn't render at all (not a command attempt, or a non-empty
 * query with zero matches — "no matches: dropdown simply doesn't render," per both tickets'
 * Functional Requirements). */
export function autocompleteMatches(
  commands: readonly CommandEntry[],
  input: string,
): CommandEntry[] | null {
  const query = commandQueryFromInput(input);
  if (query === null) return null;
  const matches = filterCommands(commands, query);
  if (matches.length === 0) return null;
  return matches;
}
