// DH-0174 (Core, extracted from cli.ts): `dh --help`/`-h` content and rendering.
// DH-0103: reuse the TUI's word-boundary-aware wrapper for --help's description wrapping
// rather than a third implementation — a pure text utility (no TUI-specific deps), so a
// direct import is clean per the ticket's own preference over extracting a shared module.
import { wrapText } from "../tui/width.ts";
import { CLI_RESET, cliBold, cliDim } from "./styling.ts";

/** Content for `--help`/`-h` (DH-0103): the flag/subcommand names and their descriptions are
 * unchanged from the prior static `HELP_TEXT`, but layout (column width, wrapping, styling)
 * is now computed by `renderHelpText` below rather than hand-spaced in a template literal. */
interface HelpItem {
  name: string;
  desc: string;
}

const HELP_TITLE = "dh — Dark Harness: an autonomous coding agent harness.";

const HELP_USAGE_ITEMS: readonly HelpItem[] = Object.freeze([
  { name: "dh", desc: "Local server + console TUI, one process." },
  { name: "dh --web", desc: "Local server + locally-served web UI." },
  { name: "dh --server", desc: "Headless server only (port 4000, or --port)." },
  { name: "dh --connect <host>", desc: "Console client to a remote server." },
  {
    name: "dh --connect <host> --web",
    desc: "Web client, locally served, connected to a remote server.",
  },
  { name: "dh init", desc: "Scaffold a starter dh.json in the working directory." },
  { name: "dh doctor", desc: "Alias for --check." },
  {
    name: "dh logs <sessionDir>",
    desc: 'Print the agent tree (status/cost/duration) for a ".dh-logs/<sessionId>" directory — DH-0037.',
  },
  {
    name: "dh logs",
    desc: 'List sessions under "./.dh-logs" (id, start time, agent count) — DH-0067.',
  },
  {
    name: "dh --import <path>",
    desc:
      'Import a real Claude Code session (backup-archive dir or a live ".jsonl" file) ' +
      "into a new resumable dh session (DH-0187/DH-0189).",
  },
]);

const HELP_FLAG_ITEMS: readonly HelpItem[] = Object.freeze([
  {
    name: "--web",
    desc: "Serve the web UI instead of (or alongside --connect) the console TUI.",
  },
  { name: "--server", desc: "Run headless (no client attached)." },
  {
    name: "--quiet",
    desc:
      "Suppress the --server activity feed (agent lifecycle lines, SSE client connect/" +
      "disconnect lines). The one-time startup block still prints regardless.",
  },
  {
    name: "--connect <host>",
    desc: "Connect to a remote dh --server instead of starting a local one.",
  },
  {
    name: "--port <n>",
    desc: "Listen port for --server, or target port for --connect (default 4000).",
  },
  {
    name: "--web-port <n>",
    desc:
      "Pin the web UI's listen port (default: random). Requires --web; overrides " +
      "dh.json's security.webPort when both are set (DH-0168).",
  },
  {
    name: "--host <name>",
    desc:
      "Override dh.json's security.hostname (the bind address) for this invocation only " +
      "(DH-0182).",
  },
  {
    name: "--instructions <file>",
    desc: "Path to an instructions file; starts the root agent on it immediately.",
  },
  {
    name: "--job",
    desc:
      "Headless mode: no TUI/Web session attaches; exit when the root agent finishes " +
      "(0 success, 1 self-reported failure, 2+ harness error). By default, streams a full " +
      "markdown-rendered transcript to stdout as the run progresses; see --result-only and " +
      "--json.",
  },
  {
    name: "--json",
    desc:
      "With --job: a pure format selector, orthogonal to breadth. Default breadth: stream " +
      "NDJSON progress events to stdout as the run happens, closed by a final job_result " +
      "line. With --result-only: print a single job_result JSON object at the end. Requires " +
      "--job.",
  },
  {
    name: "--result-only",
    desc:
      "With --job: print only the final result at the end (today's markdown default streams " +
      "the full transcript instead) — plain text, or a single JSON object with --json. " +
      "Requires --job.",
  },
  { name: "--config <path>", desc: "Path to dh.json (default: ./dh.json)." },
  {
    name: "--env <file>",
    desc:
      "Load dotenv-style environment variables from <file> before dh.json is loaded, so its " +
      "$(VAR) interpolation can see them.",
  },
  {
    name: "--check",
    desc:
      "For each configured model, make one cheap no-op provider call and report pass/fail, " +
      'then exit. Never enters the agent loop. Same as the "dh doctor" subcommand.',
  },
  {
    name: "--dry-run",
    desc:
      "Validate config parsing, instructions file readability, and provider client " +
      "construction, then exit 0. Never calls a model.",
  },
  {
    name: "--resume <sessionId>",
    desc:
      'Reconstruct the root agent\'s conversation from a prior ".dh-logs/<sessionId>" ' +
      "directory and continue it as a new session (DH-0038). Not supported with --connect.",
  },
  {
    name: "--import <path>",
    desc:
      'Import a Claude Code session — a directory with manifest.json/a lone ".jsonl", or a ' +
      'live "<id>.jsonl" file — into a new resumable dh session, then continue it via the ' +
      "same launch path as --resume (DH-0187/DH-0189). Not supported with --connect, " +
      "--resume, --check, or --dry-run.",
  },
  {
    name: "--model <alias>",
    desc:
      "With --import: the dh model alias the imported session resumes under (must resolve " +
      "against dh.json). Defaults to dh.json's options.defaultModel when omitted. Requires " +
      "--import.",
  },
  { name: "--help, -h", desc: "Show this help and exit." },
  { name: "--version", desc: "Show build identity (version, git sha, dirty flag) and exit." },
]);

const HELP_FOOTER =
  "Config: dh.json in the working directory (or --config <path>). See README.md for the schema.";

/** Below this description-column width, a two-column layout stops being useful (names and
 * wrapped text both cramp) — DH-0103 picks 24 as a reasonable floor: enough for a short
 * sentence fragment per wrapped line without degenerating into one word per row. */
const HELP_MIN_DESC_COLUMN = 24;

const HELP_CYAN_BOLD = "\x1b[1;36m";

/** `name` styled bold (TTY only) — flag/subcommand names pop against dim descriptions. */
function helpNameStyle(name: string, tty: boolean): string {
  return cliBold(name, tty);
}

/** Section header (`Usage:`/`Flags:`) styled bold+cyan (TTY only) per style-guide §2.2/§2.3
 * ("cyan reserved for structural/informational chrome — not a status"). */
function helpSectionHeader(title: string, tty: boolean): string {
  return tty ? `${HELP_CYAN_BOLD}${title}${CLI_RESET}` : title;
}

/** Renders one `name` + word-wrapped `desc` item as one or more lines, hang-indented to
 * `descColumn` on continuation lines. `nameColumn` is the width reserved for the name field
 * (padding computed from the plain, unstyled name — styling is applied after padding so SGR
 * bytes never throw off alignment). */
function renderHelpItemTwoColumn(
  item: HelpItem,
  nameColumn: number,
  indent: number,
  columns: number,
  tty: boolean,
): string[] {
  const descColumn = indent + nameColumn + 2;
  const descWidth = Math.max(1, columns - descColumn);
  const descLines = wrapText(item.desc, descWidth);
  const pad = " ".repeat(Math.max(0, nameColumn - item.name.length));
  const lines: string[] = [];
  const firstDesc = descLines[0] ?? "";
  lines.push(
    `${" ".repeat(indent)}${helpNameStyle(item.name, tty)}${pad}  ${cliDim(firstDesc, tty)}`,
  );
  for (const line of descLines.slice(1)) {
    lines.push(`${" ".repeat(descColumn)}${cliDim(line, tty)}`);
  }
  return lines;
}

/** Single-column fallback (narrow terminals): name on its own line, description wrapped and
 * indented below it — used once the two-column description width would drop below
 * `HELP_MIN_DESC_COLUMN`. */
function renderHelpItemSingleColumn(item: HelpItem, columns: number, tty: boolean): string[] {
  const bodyIndent = 4;
  const descWidth = Math.max(1, columns - bodyIndent);
  const descLines = wrapText(item.desc, descWidth);
  const lines = [`  ${helpNameStyle(item.name, tty)}`];
  for (const line of descLines) {
    lines.push(`${" ".repeat(bodyIndent)}${cliDim(line, tty)}`);
  }
  return lines;
}

function renderHelpSection(
  title: string,
  items: readonly HelpItem[],
  columns: number,
  tty: boolean,
): string[] {
  const indent = 2;
  const nameColumn = Math.max(...items.map((item) => item.name.length));
  const descWidth = columns - (indent + nameColumn + 2);
  const singleColumn = descWidth < HELP_MIN_DESC_COLUMN;
  const lines = [helpSectionHeader(title, tty)];
  for (const item of items) {
    lines.push(
      ...(singleColumn
        ? renderHelpItemSingleColumn(item, columns, tty)
        : renderHelpItemTwoColumn(item, nameColumn, indent, columns, tty)),
    );
  }
  return lines;
}

/**
 * DH-0103: `dh --help`'s renderer — replaces the old hand-spaced `HELP_TEXT` template literal
 * with a structured layout computed from the actual flag/subcommand name lengths, word-
 * wrapped (via TUI's `wrapText`, imported directly from `src/tui/width.ts` — it's a pure text
 * utility with no TUI-specific dependencies, so no third wrapper/shared-module extraction was
 * needed per the ticket's "if it can be cleanly imported... do that" guidance) to `columns`
 * with hang-indent on continuation lines, and TTY-gated colored per style-guide §2.2/§2.3
 * (app name bold, section headers bold/cyan, flag names bold, descriptions dim). Content is
 * unchanged from the prior static text — layout/styling only, per the ticket's explicit scope.
 */
/** Terminal width for `--help`: `process.stdout.columns` — the same signal the TUI uses —
 * else a parsed `$COLUMNS` (set by many shells/terminal multiplexers even when stdout isn't a
 * TTY, e.g. piped through `less` or captured by a wrapper script), else 80. */
export function helpColumns(): number {
  if (process.stdout.columns) return process.stdout.columns;
  const fromEnv = Number(process.env.COLUMNS);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return 80;
}

export function renderHelpText(columns: number, tty: boolean): string {
  const titleLines = wrapText(HELP_TITLE, Math.max(1, columns));
  const lines: string[] = [...titleLines.map((line) => cliBold(line, tty)), ""];
  lines.push(...renderHelpSection("Usage:", HELP_USAGE_ITEMS, columns, tty));
  lines.push("");
  lines.push(...renderHelpSection("Flags:", HELP_FLAG_ITEMS, columns, tty));
  lines.push("");
  lines.push(...wrapText(HELP_FOOTER, Math.max(1, columns)));
  return `${lines.join("\n")}\n`;
}
