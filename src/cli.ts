// CLI entry point (docs/handoffs/core.md §5). Parses flags, composes the run mode per
// HANDOFF.md §2 / ADR 0001, and either:
//   - runs the root agent directly via AgentRuntime for the standalone `--instructions`
//     dark-factory path (bypasses Server/TUI/Web entirely — see the Round 2 status log in
//     docs/handoffs/core.md for why that's a deliberate choice, not an oversight), or
//   - wires up the real Server/TUI/Web domains for the four interactive run modes (`--server`,
//     local console, local `--web`, `--connect [--web]`), via a thin AgentLoopHandle adapter
//     (AgentRuntimeLoopAdapter below) bridging Core's AgentRuntime to Server's own interface
//     for exactly this purpose (src/server/agent-loop.type.ts's doc comment, and Grace's own
//     round-1 status-log note, both call this out as the intended integration point).

// DH-0164: MUST be the first import in this file — see its own comment for why. Clears
// CI/CONTINUOUS_INTEGRATION before anything later in this file's import graph (including
// `./tui/index.ts` -> `./ink/mount.ts` -> `ink`) gets a chance to evaluate `is-in-ci`.
import "./tui/ink/clear-ci-env-for-interactive-render.ts";

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ROOT_AGENT_ID } from "./agent/agent-id.constant.ts";
import { createProvider } from "./agent/providers/index.ts";
import type { ModelProvider, ProviderToolDefinition } from "./agent/providers/types.ts";
import { loadResumeSession, type ResumeResult } from "./agent/resume.ts";
import { AgentRuntime, type AgentRuntimeOptions } from "./agent/runtime.ts";
import { BUILD_INFO } from "./config/build-info.ts";
import { ConfigError, DEFAULT_CONFIG_PATH, loadConfig } from "./config/index.ts";
import type {
  AgentStatus,
  AgentTreeNode,
  DhConfig,
  ExitCode as ExitCodeType,
  JobResultLine,
  ModelInfo,
  OutcomeReportedBy,
  ProviderConfig,
  ReportedOutcome,
  SecurityConfig,
  ServerSentEvent,
  SessionClientKind,
  SkillInfo,
} from "./contracts/index.ts";
import { ExitCode } from "./contracts/index.ts";
import {
  buildHeaderInfo,
  formatHeaderLines,
  formatVersionString,
  type HeaderInfo,
} from "./header-info.ts";
import { loadSystemPrompt } from "./prompt/system-prompt.ts";
import {
  type AgentLoopEventListener,
  type AgentLoopHandle,
  type AgentLoopLogListener,
  buildSessionSummary,
  DhServer,
  type DhServerOptions,
  formatSessionList,
  formatSessionLogTree,
  pruneLogDirectories,
  SessionLogger,
  type Unsubscribe,
  writeSessionSummary,
} from "./server/index.ts";
import { SPINNER_FRAME_MS, SPINNER_FRAMES } from "./terminal.constant.ts";
import { startTui as startTuiClient } from "./tui/index.ts";
// DH-0103: reuse the TUI's word-boundary-aware wrapper for --help's description wrapping
// rather than a third implementation — a pure text utility (no TUI-specific deps), so a
// direct import is clean per the ticket's own preference over extracting a shared module.
import { wrapText } from "./tui/width.ts";
// DH-0101: reuse Web's short-id formatter for the activity feed rather than forking the
// logic (ticket's explicit ask) — pure, DOM-free (only a type-only import of its own), and
// Web's client bundle is already part of this binary's dependency graph via serveWebUiClient
// below, so this adds no new runtime surface.
import { shortAgentId } from "./web/client/format.ts";
import { serveWebUi as serveWebUiClient } from "./web/server.ts";

export const DEFAULT_PORT = 4000;

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export interface CliOptions {
  web: boolean;
  server: boolean;
  connect: string | null;
  port: number | null;
  instructions: string | null;
  job: boolean;
  /** DH-0050: `--job --json` — NDJSON progress stream on stdout, closed by a terminal
   * `job_result` line (`JobResultLine`, src/contracts/outcome.ts). Invalid without --job. */
  json: boolean;
  config: string;
  env: string | null;
  /** DH-0035: `--check` (or the `dh doctor` subcommand, an alias set by main()) — runs one
   * cheap no-op provider call per configured model and exits, never entering the agent loop. */
  check: boolean;
  /** DH-0035: validates config/instructions/provider-client construction and exits 0 without
   * ever calling a model. */
  dryRun: boolean;
  /** DH-0038: `--resume <sessionId>` — reconstructs the root agent's conversation from
   * `.dh-logs/<sessionId>` (walking any `resumedFrom` chain) instead of starting fresh. Null
   * when not resuming. */
  resume: string | null;
  /** DH-0067: suppresses the per-agent-lifecycle-transition activity feed and SSE client
   * connect/disconnect lines that `--server` mode now prints by default (see
   * runInteractiveMode's activity-feed wiring). Does not affect the one-time startup block —
   * that always prints regardless of `--quiet`. */
  quiet: boolean;
}

const FLAGS_WITH_VALUES = Object.freeze(
  new Set(["--connect", "--port", "--instructions", "--config", "--env", "--resume"]),
);

/** DH-0035/DH-0096: the `dh.json` scaffolded by `dh init` — kept byte-for-byte in sync with
 * README.md's own sample config so the two never drift apart.
 *
 * DH-0096: every model id below was verified live against the real provider APIs (Bedrock
 * `ListFoundationModels`/`ListInferenceProfiles` + a smoke-test `Converse` call; Anthropic-
 * direct ids cross-checked against the Claude API skill's model catalog) rather than typed
 * from memory — see DH-0092, the incident this ticket exists to prevent from recurring at
 * larger scale. The Bedrock model/inference-profile ids are verified correct for the
 * `us-east-1` region specifically (via cross-region `us.*` inference profiles for the Claude
 * tiers) — Bedrock catalogs are region-specific and change over time, so a scaffold that's
 * correct here may 404 in another region; re-verify before relying on this list elsewhere.
 * This is a menu of working entries to trim to what you actually use, not a recommendation
 * to run `dh doctor` against all of them by default (see the `dh init` stdout note below). */
export const SAMPLE_DH_JSON = Object.freeze(`{
  "options": { "defaultModel": "haiku-bedrock", "runInBackgroundDefault": true, "maxTurns": 100 },
  "models": [
    { "name": "fable-anthropic", "provider": "anthropic", "model": "claude-fable-5" },
    { "name": "fable-bedrock", "provider": "bedrock", "model": "us.anthropic.claude-fable-5" },
    { "name": "opus-anthropic", "provider": "anthropic", "model": "claude-opus-4-8" },
    { "name": "opus-bedrock", "provider": "bedrock", "model": "us.anthropic.claude-opus-4-8" },
    {
      "name": "sonnet-anthropic",
      "provider": "anthropic",
      "model": "claude-sonnet-5",
      "inputPricePerMToken": 3,
      "outputPricePerMToken": 15
    },
    { "name": "sonnet-bedrock", "provider": "bedrock", "model": "us.anthropic.claude-sonnet-5" },
    { "name": "haiku-anthropic", "provider": "anthropic", "model": "claude-haiku-4-5" },
    {
      "name": "haiku-bedrock",
      "provider": "bedrock",
      "model": "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    },
    { "name": "gemma4", "provider": "mantle-openai", "model": "google.gemma-4-31b" },
    {
      "name": "haiku-mantle",
      "provider": "mantle-anthropic",
      "model": "anthropic.claude-haiku-4-5"
    },
    { "name": "gpt-oss-20b", "provider": "bedrock", "model": "openai.gpt-oss-20b-1:0" },
    { "name": "gpt-oss-120b", "provider": "bedrock", "model": "openai.gpt-oss-120b-1:0" },
    {
      "name": "llama3-3-70b",
      "provider": "bedrock",
      "model": "us.meta.llama3-3-70b-instruct-v1:0"
    },
    {
      "name": "mistral-large-3",
      "provider": "bedrock",
      "model": "mistral.mistral-large-3-675b-instruct"
    }
  ],
  "provider": [
    { "name": "anthropic", "type": "anthropic", "apiKey": "$(ANTHROPIC_API_KEY)" },
    { "name": "bedrock", "type": "bedrock", "region": "$(AWS_REGION)" },
    {
      "name": "mantle-anthropic",
      "type": "anthropic",
      "baseURL": "https://bedrock-mantle.$(AWS_REGION).api.aws/anthropic",
      "apiKey": "$(BEDROCK_MANTLE_API_KEY)"
    },
    {
      "name": "mantle-openai",
      "type": "openai-compatible",
      "baseURL": "https://bedrock-mantle.$(AWS_REGION).api.aws/openai/v1",
      "apiKey": "$(BEDROCK_MANTLE_API_KEY)"
    },
    { "name": "local", "type": "anthropic", "baseURL": "$(LOCAL_AI_PROVIDER)" }
  ],
  "skillPaths": ["./skills"],
  "mcpServers": {},
  "systemPrompt": null,
  "security": { "token": null, "tls": null }
}
`);

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
    name: "--instructions <file>",
    desc: "Path to an instructions file; starts the root agent on it immediately.",
  },
  {
    name: "--job",
    desc: "Exit when the root agent finishes: 0 success, 1 self-reported failure, 2+ harness error.",
  },
  {
    name: "--json",
    desc:
      "With --job: stream NDJSON progress events to stdout as the run happens, closed by a " +
      "final job_result line. Requires --job.",
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
function helpColumns(): number {
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

// ---------------------------------------------------------------------------------------
// DH-0101: shared CLI styling helpers — docs/design/style-guide.md §1 (status colors),
// §1.1 (liveness), §2.2/§2.3 (SGR palette), §3 (glyphs), §5 (CLI conventions). Every
// TTY-gated color/glyph across init/doctor/server-startup/activity-feed goes through this
// one small block instead of each surface reinventing green/red/dim/✓/✗ — this generalizes
// what DH-0099 first did just for `dh doctor` (whose own DOCTOR_* constants below now alias
// these instead of duplicating the literals).
//
// Judgment call: the ticket's §5 text ("verdict glyphs (TTY-gated, color per §1)") reads as
// ambiguous about whether the TTY gate covers just the *color* or the glyph too. This module
// gates both together — off a TTY, every helper below returns "" (no glyph, no SGR) — which
// matches doctor's existing non-TTY behavior (plain "PASS"/"FAIL" words, no unicode at all)
// and is the safer choice for the ticket's own stated risk (piping into a log aggregator
// must stay byte-plain; some aggregators mis-handle non-ASCII as readily as raw SGR bytes).
const CLI_GREEN = "\x1b[32m";
const CLI_RED = "\x1b[31m";
const CLI_YELLOW = "\x1b[33m";
const CLI_DIM = "\x1b[2m";
const CLI_BOLD = "\x1b[1m";
const CLI_RESET = "\x1b[0m";

// Canonical status→SGR map (style-guide §1/§2.3). Kept as its own literal rather than
// imported, matching the existing DH-0100 pattern where src/server/log-analysis.ts and
// src/tui/render.ts each already keep an independent copy of the same five-entry map — the
// canonical source of truth is the style-guide table, not any one file.
const CLI_STATUS_COLOR: Record<AgentStatus, string> = Object.freeze({
  running: "\x1b[34m",
  waiting: "\x1b[33m",
  done: "\x1b[32m",
  failed: "\x1b[31m",
  stopped: "\x1b[35m",
});

function cliColorize(text: string, code: string, tty: boolean): string {
  return tty ? `${code}${text}${CLI_RESET}` : text;
}

/** `✓ ` (green, TTY-only) prefix for a success headline; `""` off-TTY. */
function cliSuccessGlyph(tty: boolean): string {
  return tty ? `${CLI_GREEN}✓${CLI_RESET} ` : "";
}

/** `⚠ ` (yellow, TTY-only) prefix for a caution/posture note; `""` off-TTY. */
function cliCautionGlyph(tty: boolean): string {
  return tty ? `${CLI_YELLOW}⚠${CLI_RESET} ` : "";
}

/** Status-colored `●` (TTY-only) for an activity-feed lifecycle line; `""` off-TTY (the
 * status word itself still appears in the line — never color-only, per style-guide §1). */
function cliStatusDot(status: AgentStatus, tty: boolean): string {
  return tty ? `${CLI_STATUS_COLOR[status]}●${CLI_RESET} ` : "";
}

/** Dims text (TTY-only) — indented supporting detail/caveats, timestamps. */
function cliDim(text: string, tty: boolean): string {
  return cliColorize(text, CLI_DIM, tty);
}

/** Bolds text (TTY-only) — light emphasis (`--version`'s app name). */
function cliBold(text: string, tty: boolean): string {
  return cliColorize(text, CLI_BOLD, tty);
}

/** DH-0067: `dh --server` binds every interface by default (DH-0022 added an opt-in
 * `security.hostname` config field to restrict this — see DhServer.start() — but it's unset
 * unless an operator sets it), so a plaintext, unauthenticated bind is reachable from
 * anywhere on the network, not just localhost, in the common case. ADR 0003's stance is
 * "air-gapping is the primary posture, `security.token`/`security.tls` are opt-in" — this is
 * the one moment
 * an operator is actually looking at the terminal, so it says so once at startup rather than
 * leaving it to a README they may never open. Returns undefined once either a bearer token
 * or TLS is configured (either narrows the exposure this note exists to flag).
 */
export function buildStartupPostureNote(security: SecurityConfig | undefined): string | undefined {
  if (security?.token || security?.tls) return undefined;
  return "dh: plaintext HTTP, no auth — see README security posture.";
}

/** DH-0122: the app header every `dh` invocation prints — name/version/build identity plus
 * `dh.json`'s config status (model count, bind address, whether a token/TLS is required —
 * the bits an operator connecting from another process/machine needs). Shares its content
 * with the TUI's `<Header>` and Web's `<AppHeader>` via `buildHeaderInfo`/`formatHeaderLines`
 * (header-info.ts) so all three surfaces agree on the same facts. Non-TTY output stays plain
 * (no logo, no color) so a piped/CI run isn't polluted with ASCII art; a real terminal gets
 * the full logo and a bolded version line, matching the style guide §5 "startup blocks read
 * as a panel" convention already used by the rest of this file's startup output. */
function printAppHeader(config: DhConfig, configPath: string, io: CliIo): void {
  const tty = process.stdout.isTTY === true;
  const info = buildHeaderInfo(config, configPath, BUILD_INFO);
  const lines = formatHeaderLines(info, { compact: !tty });
  for (const line of lines) {
    io.stdout(line === formatVersionString(info.build) ? cliBold(line, tty) : line);
  }
}

/**
 * DH-0067: after startup, `--server` mode used to go completely silent through real agent
 * activity — a message arrived, a root agent ran a full turn, and the terminal showed
 * nothing at all; the only way to know anything happened was to already know where the
 * JSONL logs lived. Formats one concise stdout line per agent lifecycle transition (spawn,
 * status change, session end) — never full output, that stays the clients' and the JSONL
 * logs' job (`--quiet` restores the old silence entirely, at the call site in
 * runInteractiveMode). `token_usage` events accumulate silently per agent and surface only
 * alongside that agent's next status-transition line — cumulative, not a line per turn,
 * per the ticket's own "cheap and glanceable" resolution of its open question.
 */
export class ActivityFeed {
  private readonly usage = new Map<string, { tokens: number; costUsd?: number }>();

  /** Returns the line to print (without the `dh: ` prefix — the caller adds that), or
   * undefined when this event produces no line of its own (`token_usage` accumulates
   * silently; `resync` is a server-internal SSE-resume detail with nothing to report here).
   *
   * DH-0101: short agent id (never the full 36-char UUID — style-guide §4; the full id stays
   * traceable in the JSONL logs) and a dim timestamp on every line; `agent_status` lines also
   * get a status-colored `●` matching the canonical five-status palette (style-guide §1). Both
   * TTY-gated via `tty` (default false — matches ActivityFeed's existing call site passing an
   * explicit flag; tests exercising the plain-text contract need no changes). */
  onEvent(event: ServerSentEvent, tty = false): string | undefined {
    const time = cliDim(new Date(event.timestamp).toTimeString().slice(0, 8), tty);
    if (event.type === "token_usage") {
      const state = this.usage.get(event.agentId) ?? { tokens: 0 };
      state.tokens += event.inputTokens + event.outputTokens;
      if (event.costUsd !== undefined) {
        state.costUsd = (state.costUsd ?? 0) + event.costUsd;
      }
      this.usage.set(event.agentId, state);
      return undefined;
    }
    if (event.type === "agent_spawned") {
      const id = shortAgentId(event.agentId);
      const label = event.description ? `${id} (${event.description})` : id;
      return `${time} ${label} spawned (${event.model})`;
    }
    if (event.type === "agent_status") {
      const state = this.usage.get(event.agentId);
      const usageSuffix =
        state === undefined
          ? ""
          : ` — ${state.tokens.toLocaleString()} tok${state.costUsd !== undefined ? ` / $${state.costUsd.toFixed(4)}` : ""}`;
      const dot = cliStatusDot(event.status, tty);
      return `${time} ${dot}${shortAgentId(event.agentId)} ${event.status}${usageSuffix}`;
    }
    if (event.type === "session_ended") {
      return `${time} session ended (exit code ${event.exitCode})`;
    }
    return undefined;
  }
}

/** Parses argv (excluding the `bun`/script prefix — pass `process.argv.slice(2)`). Throws
 * CliUsageError on anything malformed; never exits or prints — that's main()'s job. */
export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    web: false,
    server: false,
    connect: null,
    port: null,
    instructions: null,
    job: false,
    json: false,
    config: DEFAULT_CONFIG_PATH,
    env: null,
    check: false,
    dryRun: false,
    resume: null,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--web") {
      options.web = true;
      continue;
    }
    if (arg === "--server") {
      options.server = true;
      continue;
    }
    if (arg === "--job") {
      options.job = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg !== undefined && FLAGS_WITH_VALUES.has(arg)) {
      i += 1;
      const value = argv[i];
      if (value === undefined) {
        throw new CliUsageError(`${arg} requires a value`);
      }
      if (arg === "--connect") options.connect = value;
      else if (arg === "--instructions") options.instructions = value;
      else if (arg === "--config") options.config = value;
      else if (arg === "--env") options.env = value;
      else if (arg === "--resume") options.resume = value;
      else {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new CliUsageError(`--port must be a positive integer, got "${value}"`);
        }
        options.port = parsed;
      }
      continue;
    }
    throw new CliUsageError(`unknown flag: ${arg}`);
  }

  // DH-0050: --json is only meaningful alongside --job (the NDJSON stream's terminal
  // job_result line is exactly the --job exit-code decision, expressed as data) — a usage
  // error here, not a silent no-op, so an operator's misconfigured invocation fails loudly.
  if (options.json && !options.job) {
    throw new CliUsageError("--json requires --job");
  }

  return options;
}

export type RunMode =
  | { kind: "local"; web: boolean }
  | { kind: "server"; port: number }
  | { kind: "connect"; host: string; port: number; web: boolean };

/** Mode composition per HANDOFF.md §2's invocation table. Pure function of parsed flags. */
export function composeMode(options: CliOptions): RunMode {
  if (options.connect !== null) {
    return {
      kind: "connect",
      host: options.connect,
      port: options.port ?? DEFAULT_PORT,
      web: options.web,
    };
  }
  if (options.server) {
    return { kind: "server", port: options.port ?? DEFAULT_PORT };
  }
  return { kind: "local", web: options.web };
}

async function readInstructionsFile(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new ConfigError(`instructions file not found: ${path}`);
  }
  return file.text();
}

async function readEnvFile(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new ConfigError(`env file not found: ${path}`);
  }
  return file.text();
}

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

/**
 * Bridges Core's AgentRuntime (a single fixed onEvent/onLogLine callback pair, set at
 * construction) to Server's AgentLoopHandle (multi-subscriber onEvent/onLog, plus
 * sendMessage/stopAgent/getAgentTree) — the integration point flagged in both
 * src/server/agent-loop.type.ts's doc comment and Grace's round-1 status-log note ("(b) a thin
 * wrapper in src/cli.ts bridges Core's actual shape to this one").
 *
 * Identifier space (docs/handoffs/core.md Round 2 status log): "agentId" here is always the
 * SAME string AgentRuntime already uses for its own SSE events/log lines — ROOT_AGENT_ID for
 * the root, and (as of this round) the task registry's own id for every sub-agent, since
 * AgentRuntime.spawnAgent() now passes its loop-internal id as the task's id too. No
 * translation table needed.
 *
 * Root agent lifecycle: interactive mode has no `--instructions` file, so the root agent
 * doesn't start until the operator's first message arrives (matches HANDOFF.md §8's "text
 * input for sending it messages" — there's nothing to show until something is sent).
 * sendMessage(ROOT_AGENT_ID, ...) lazily starts it on the first call (fire-and-forget; a
 * synthetic `agent_status: failed` event covers a harness error that prevents it from ever
 * starting, so a broken provider/config doesn't silently vanish) and steers the
 * already-running loop on every call after that.
 */
export class AgentRuntimeLoopAdapter implements AgentLoopHandle {
  readonly runtime: AgentRuntime;
  private readonly eventListeners = new Set<AgentLoopEventListener>();
  private readonly logListeners = new Set<AgentLoopLogListener>();

  constructor(options: {
    config: DhConfig;
    systemPrompt: string;
    client: SessionClientKind;
    // DH-0116: runMode() generates this once and uses it as the logDir/DhServer sessionId
    // too — passed through so AgentRuntime stamps the SAME id into every log header it
    // writes, instead of defaulting to a fresh randomUUID() of its own that would mismatch
    // the directory those headers land in (breaking --resume's header/directory consistency
    // check, resume.ts's loadHop). Optional here only so unit tests constructing this
    // adapter directly (not through runMode()) don't all need an unused id — AgentRuntime's
    // own randomUUID() fallback covers that case, same as before this fix.
    sessionId?: string;
    resume?: AgentRuntimeOptions["resume"];
  }) {
    this.runtime = new AgentRuntime({
      config: options.config,
      systemPrompt: options.systemPrompt,
      client: options.client,
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      // Round 5 (docs/handoffs/core.md status log): every interactive session — server/TUI/
      // Web, root and sub-agents alike — pauses instead of ending on a non-tool-use turn.
      // The standalone `--instructions`/`--job` path (defaultDeps().createRuntime) never sets
      // this, preserving its original end-on-first-non-tool-call behavior exactly.
      interactive: true,
      ...(options.resume ? { resume: options.resume } : {}),
      onEvent: (event) => {
        for (const listener of this.eventListeners) listener(event);
      },
      onLogLine: (agentId, line) => {
        for (const listener of this.logListeners) listener(agentId, line);
      },
    });
  }

  onEvent(listener: AgentLoopEventListener): Unsubscribe {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onLog(listener: AgentLoopLogListener): Unsubscribe {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  sendMessage(agentId: string, message: string): void {
    if (agentId !== ROOT_AGENT_ID) {
      this.runtime.sendMessage(agentId, message);
      return;
    }
    if (!this.runtime.rootHasStarted) {
      // Fire-and-forget: the command handler (POST /api/commands) shouldn't block on the
      // whole root agent run just to acknowledge "message accepted" — progress streams via
      // onEvent/onLog as normal. A harness error before the loop ever gets going (bad
      // model/provider config) would otherwise be an unhandled rejection.
      //
      // DH-0131 fix: this used to hand-construct a synthetic agent_status:"failed" SSE event
      // here (and, before that, only a plain "message" log line — never a structured
      // status_change) because AgentRuntime.runRoot() itself didn't emit anything but
      // session_ended on this failure class. AgentRuntime.runRoot() now emits the full
      // message/status_change/agent_status/session_ended sequence itself (runtime.ts) via the
      // same onEvent/onLogLine callbacks this adapter's constructor already forwards into
      // eventListeners/logListeners — duplicating that here would double-log the failure, so
      // this just needs to swallow the rejection (already thrown/logged upstream) rather than
      // let it become an unhandled promise rejection.
      this.runtime.runRoot(message).catch(() => {});
      return;
    }
    this.runtime.sendMessageToRoot(message);
  }

  stopAgent(agentId: string): void {
    if (agentId === ROOT_AGENT_ID) {
      // Round 3 fix (docs/handoffs/core.md status log): this used to be a documented no-op
      // — loop.ts had no cooperative cancellation at all. AgentRuntime.stopRoot() now
      // triggers the root's own AbortController; see loop.ts's AgentLoopParams.signal doc
      // comment for exactly what "stop" does and doesn't interrupt (between-turns and the
      // in-flight provider call, not a tool call already in progress).
      this.runtime.stopRoot();
      return;
    }
    this.runtime.tasks.stop(agentId);
  }

  getAgentTree(): AgentTreeNode[] {
    return this.runtime.getAgentTree();
  }

  /** DH-0093: thin delegations to AgentRuntime — the adapter's job here is only to bridge
   * the wire-facing AgentLoopHandle shape onto Core's actual methods, same as every other
   * method in this class. */
  listModels(): ModelInfo[] {
    return this.runtime.listModels();
  }

  switchModel(agentId: string, model: string): void {
    this.runtime.switchModel(agentId, model);
  }

  listSkills(): SkillInfo[] {
    return this.runtime.listSkills();
  }

  invokeSkill(agentId: string, skill: string, args: string | undefined): Promise<void> {
    return this.runtime.invokeSkill(agentId, skill, args);
  }

  /** DH-0002: delegates to the underlying AgentRuntime.close() (closes the shared
   * McpManager, terminating any stdio MCP child processes) — called from this module's own
   * SIGTERM/SIGINT shutdown handling below, not a separate mechanism. */
  async close(): Promise<void> {
    await this.runtime.close();
  }
}

export interface DhServerLike {
  start(): number;
  stop(): void;
}

export interface WebUiHandleLike {
  url: string;
  stop(): void;
}

export interface CliIo {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  exit: (code: ExitCodeType) => void;
}

export interface CliDeps {
  loadConfig: (path: string) => Promise<DhConfig>;
  readInstructions: (path: string) => Promise<string>;
  readEnvFile: (path: string) => Promise<string>;
  applyEnv: (vars: Record<string, string>) => void;
  loadSystemPrompt: (config: DhConfig) => Promise<string>;
  /** DH-0035 (`dh init`): whether a file already exists at `path` — injectable so tests never
   * touch the real filesystem. */
  fileExists: (path: string) => Promise<boolean>;
  /** DH-0035 (`dh init`): writes `contents` to `path`, creating it. */
  writeFile: (path: string, contents: string) => Promise<void>;
  /** DH-0035 (`dh doctor`/`--check`, `--dry-run`): builds the real provider adapter for a
   * `dh.json` provider entry — injectable so tests can supply a fake that never hits the
   * network. Construction itself (as opposed to `.complete()`) is synchronous today for both
   * built-in adapters, but the signature stays sync-or-throw either way. */
  createProvider: (config: ProviderConfig) => ModelProvider;
  /** DH-0038: reconstructs a `--resume <sessionId>` session's replayed history + metadata
   * from `.dh-logs/<sessionId>` (walking any `resumedFrom` chain). Synchronous, throws
   * `ResumeError` (see src/agent/resume.ts) for every documented failure mode (D6) — callers
   * route it through the standard `fail()` path, never letting it crash the process.
   * Injectable so tests never touch the real filesystem. */
  loadResumeSession: (logsRoot: string, sessionId: string) => ResumeResult;
  /** Used only by the standalone `--instructions` path (see the module doc comment above
   * for why that path never goes through createAgentLoop/createServer). Exposes `stopRoot`
   * too (DH-0011) so this path's SIGTERM/SIGINT handler has something real to call.
   * `resume` (DH-0038) is threaded straight into `AgentRuntimeOptions.resume` when a
   * `--resume` was requested; omitted for a normal (non-resumed) run. */
  createRuntime: (
    config: DhConfig,
    systemPrompt: string,
    client: SessionClientKind,
    resume?: AgentRuntimeOptions["resume"],
    /** DH-0050 (`--job --json`): forwarded straight into `AgentRuntimeOptions.onEvent` so the
     * NDJSON stream can write every `ServerSentEvent` as it happens; omitted (as before this
     * ticket) on every non-`--json` standalone run. */
    onEvent?: (event: ServerSentEvent) => void,
  ) => Pick<AgentRuntime, "runRoot" | "stopRoot"> & {
    close?: () => Promise<void>;
    /** DH-0037 (`summary.json`): the real `createStandaloneRuntime` dep's `AgentRuntime`
     * always carries its own `sessionId` — this is only optional here so the many
     * hand-written fakes in cli.test.ts that stub `createRuntime` without a session/log
     * directory (they don't exercise `summary.json`) don't all need updating just to satisfy
     * the type. Absent, `summary.json` writing is skipped (see `runInstructionsMode`).
     */
    sessionId?: string;
  };
  /** Used by every interactive mode (server/local/connect). `resume` (DH-0038): same shape
   * and purpose as `createRuntime`'s. DH-0002: the returned handle's optional `close()` —
   * present on the real `AgentRuntimeLoopAdapter` (delegates to its `AgentRuntime.close()`,
   * which in turn closes the shared McpManager, terminating any stdio MCP child processes)
   * — is called from this module's own SIGTERM/SIGINT handling below, coordinating with the
   * existing shutdown path (DH-0011) rather than adding a second one; `AgentLoopHandle`
   * itself (Server's own cross-domain contract, src/server/agent-loop.type.ts) is untouched. */
  createAgentLoop: (
    config: DhConfig,
    systemPrompt: string,
    client: SessionClientKind,
    // DH-0116: authoritative sessionId, sourced from the same id the caller uses for
    // logDir/the server's own advertised session — see AgentRuntimeLoopAdapter's doc
    // comment for why this must be threaded through rather than left to AgentRuntime's
    // own default.
    sessionId: string,
    resume?: AgentRuntimeOptions["resume"],
  ) => AgentLoopHandle & { close?: () => Promise<void> };
  createServer: (options: DhServerOptions) => DhServerLike;
  /** DH-0059: `ownsServer` tells the TUI whether this process also constructed the
   * `DhServer` it's talking to (local mode) — only this module knows, since it's the one
   * that did or didn't build one. Local mode passes `{ ownsServer: true }`; `--connect`
   * mode passes nothing, defaulting to `false` (unchanged detach-only behavior). */
  startTui: (baseUrl: string, token?: string, opts?: { ownsServer?: boolean }) => Promise<void>;
  serveWebUi: (options: {
    port: number;
    targetBaseUrl: string;
    token?: string;
    /** DH-0022: opt-in bind address, sourced from `dh.json`'s `security.hostname`. */
    hostname?: string;
    /** DH-0122: app header content forwarded to the browser via `WEB_CONFIG_PATH`. */
    headerInfo?: HeaderInfo;
  }) => WebUiHandleLike;
  io: CliIo;
  /**
   * DH-0011 fix (tracking/DH-0011-no-signal-handling-or-process-group-reaping.md): grepping
   * the whole codebase for SIGTERM/SIGINT/process.on used to return nothing — the canonical
   * dark-factory deployment (a container, per HANDOFF.md §1/§11) receives SIGTERM on
   * scale-down/redeploy, and with no handler Bun's default behavior kills the process
   * abruptly with no chance to flush a final log line or stop in-flight work. Installs a
   * handler for both signals; `onSignal` is called (at most once — a second signal during an
   * already-in-progress shutdown is a no-op here, letting the OS's own default disposition
   * take over if the operator insists) with which signal fired. Returns an uninstall
   * function. Injectable so tests never register a real `process.on` listener (which would
   * leak across test files and could fire during unrelated test-runner signal handling).
   */
  installSignalHandlers: (onSignal: (signal: "SIGTERM" | "SIGINT") => void) => () => void;
}

/**
 * Round 6a (docs/handoffs/core.md): the standalone `--instructions`/`--job` path never went
 * through Server's DhServer, so it never got a SessionLogger attached — a crashed or failed
 * unattended container run left no JSONL trail at all, for exactly the headless/unattended/
 * hours-long scenario the product is built around (HANDOFF.md §7 treats logging as
 * first-class, same weight as the agent loop itself). Fix: attach the same JSONL sink here,
 * directly, without starting an HTTP server just to get one — `SessionLogger` (Server's own
 * per-agent JSONL writer, already exported from `./server/index.ts`) is reused rather than
 * reimplemented; `loop.ts` already emits its own `LogHeader` first line per agent, so no
 * separate header-writing logic is needed here either.
 */
function createStandaloneRuntime(
  config: DhConfig,
  systemPrompt: string,
  resume?: AgentRuntimeOptions["resume"],
  onEvent?: (event: ServerSentEvent) => void,
): AgentRuntime {
  const sessionId = randomUUID();
  const logsRoot = join(process.cwd(), ".dh-logs");
  // DH-0037: config-gated `.dh-logs` rotation, off by default (see LogRetentionConfig's own
  // doc comment) — a no-op unless `dh.json` sets `logRetention`. Runs before this session's
  // own directory is created, so it never prunes itself (excludeSessionId).
  pruneLogDirectories(logsRoot, config.logRetention, Date.now(), sessionId);
  const logDir = join(logsRoot, sessionId);
  const logger = new SessionLogger(logDir);
  return new AgentRuntime({
    config,
    systemPrompt,
    sessionId,
    // The standalone `--instructions`/`--job` dark-factory path has no interactive
    // TUI/Web/server client attached — "none" per SessionClientKind's own doc comment.
    client: "none",
    ...(resume ? { resume } : {}),
    ...(onEvent ? { onEvent } : {}),
    onLogLine: (agentId, line) => logger.append(agentId, line),
  });
}

function defaultDeps(): CliDeps {
  return {
    loadConfig,
    readInstructions: readInstructionsFile,
    readEnvFile,
    applyEnv: (vars) => Object.assign(process.env, vars),
    loadSystemPrompt,
    fileExists: (path) => Bun.file(path).exists(),
    writeFile: async (path, contents) => {
      await Bun.write(path, contents);
    },
    createProvider,
    loadResumeSession,
    // The standalone path's own runtime is always constructed with client: "none" directly
    // inside createStandaloneRuntime() (it's not one of the four interactive modes this
    // `client` param maps from), so the value passed here is intentionally unused.
    createRuntime: (config, systemPrompt, _client, resume, onEvent) =>
      createStandaloneRuntime(config, systemPrompt, resume, onEvent),
    createAgentLoop: (config, systemPrompt, client, sessionId, resume) =>
      new AgentRuntimeLoopAdapter({
        config,
        systemPrompt,
        client,
        sessionId,
        ...(resume ? { resume } : {}),
      }),
    createServer: (options) => new DhServer(options),
    startTui: (baseUrl, token, opts) => startTuiClient(baseUrl, token, opts),
    serveWebUi: (options) => serveWebUiClient(options),
    io: {
      stdout: (message) => console.log(message),
      stderr: (message) => console.error(message),
      exit: (code) => process.exit(code),
    },
    installSignalHandlers: (onSignal) => {
      let firedOnce = false;
      const handler = (signal: "SIGTERM" | "SIGINT") => () => {
        if (firedOnce) return; // let a second signal fall through to the OS default.
        firedOnce = true;
        onSignal(signal);
      };
      const sigterm = handler("SIGTERM");
      const sigint = handler("SIGINT");
      process.on("SIGTERM", sigterm);
      process.on("SIGINT", sigint);
      return () => {
        process.off("SIGTERM", sigterm);
        process.off("SIGINT", sigint);
      };
    },
  };
}

function fail(io: CliIo, message: string): ExitCodeType {
  io.stderr(`dh: ${message}`);
  io.exit(ExitCode.HarnessError);
  return ExitCode.HarnessError;
}

/**
 * DH-0038: the synthetic wake-up message a `--resume`d root agent's conversation gets
 * appended (D3) when no `--instructions` file supplies one instead. States plainly what
 * happened (restart + reconstruction), names any sub-agent/task that didn't survive the
 * restart (D3's "list lost in-flight sub-agents"), and flags the two things the replayed
 * history can't fully vouch for: a dangling tool call's real outcome (D1's synthesized
 * interrupted-tool_result marker covers the *shape*, not the truth) and any `[REDACTED:...]`
 * placeholder standing in for a secret DH-0020's logging redaction stripped (D5) — re-read
 * either from source if still needed, rather than trusting what's in the reconstructed text.
 */
export function buildResumeNotice(resumeResult: ResumeResult): string {
  const lines = [
    `dh: this session was resumed after a restart from session "${resumeResult.resumedFromSessionId}". The conversation above was reconstructed from that session's JSONL logs.`,
  ];
  if (resumeResult.lostAgents.length > 0) {
    lines.push(
      "The following sub-agents/tasks were still running or waiting when the restart " +
        "happened and did not survive it — their in-flight work and any background process " +
        "is gone; re-verify what they'd done and re-spawn them if the work still needs doing:",
    );
    for (const agent of resumeResult.lostAgents) {
      const label = agent.description ? `${agent.agentId} (${agent.description})` : agent.agentId;
      lines.push(`  - ${label} [${agent.status}]`);
    }
  }
  lines.push(
    "Any tool call the restart interrupted mid-execution is marked as such above, not as " +
      "having completed successfully — its real outcome is unknown; verify before trusting or " +
      'repeating it. Any "[REDACTED:...]" placeholder above stands in for a secret that ' +
      "logging never wrote to disk — re-read the real value from its original source if you " +
      "need it again.",
  );
  return lines.join("\n");
}

/**
 * Starts whichever of the four interactive run modes `mode` composes to and returns the
 * exit code to report (Success unless starting the mode itself fails — e.g. the requested
 * `--server`/`--connect` port is already in use, a harness-error class per ADR 0006, not a
 * crash).
 *
 * Judgment call (docs/handoffs/core.md Round 2 status log, `--port` scope): only `--server`'s
 * own listen port and `--connect`'s remote target port are operator-configurable via
 * `--port`, matching ADR 0001's "listen port for --server, target port for --connect" — every
 * locally-started service that exists purely so an in-process TUI/Web client has something
 * to talk to (local mode's own DhServer; either mode's web-UI static server) binds an
 * ephemeral port (0) and prints/returns the URL instead, since HANDOFF.md never documents
 * `--port` as applying to local mode at all.
 *
 * Judgment call (client TLS): `--connect`'s targetBaseUrl dials `https://` when the
 * *connecting side's own* `dh.json` sets `security.tls` — ADR 0004 says "clients connect
 * with https:// when the target uses TLS" but leaves the "auto-detect or a client-side flag"
 * choice to the fleet. Reusing `security.tls`'s presence (already how "clients supply their
 * own token via their own dh.json" works for the bearer-token side) avoids inventing a new
 * flag or a probe-the-server-first mechanism; flagged in the status log in case a future
 * round wants true auto-detection instead.
 */
async function runInteractiveMode(
  mode: RunMode,
  config: DhConfig,
  configPath: string,
  systemPrompt: string,
  deps: CliDeps,
  resumeResult?: ResumeResult,
  quiet = false,
): Promise<ExitCodeType> {
  const { io } = deps;
  // DH-0122: the app header prints once per invocation, before anything else — including
  // before the TUI takes the alt-screen — so it's visible in scrollback on every run mode,
  // not just the console-only ones (--server, --web, --connect). Ink's own `<Header>` (see
  // src/tui/ink/Header.tsx) additionally keeps a compact form of the same content live
  // inside the full-screen TUI view itself.
  printAppHeader(config, configPath, io);
  const headerInfo = buildHeaderInfo(config, configPath, BUILD_INFO);
  try {
    if (mode.kind === "connect") {
      const scheme = config.security?.tls ? "https" : "http";
      // DH-0111: `--connect <host>` documents `<host>` as a bare hostname, but an operator
      // pasting a value from e.g. "web UI ready at http://..." output (or just guessing at
      // the flag's shape) can hand it a full origin instead. Stripping any scheme the
      // caller already supplied before prepending our own avoids a doubled
      // "http://http://host:port" target that fails to resolve.
      const host = mode.host.replace(/^https?:\/\//, "");
      const targetBaseUrl = `${scheme}://${host}:${mode.port}`;
      if (mode.web) {
        const handle = deps.serveWebUi({
          port: 0,
          targetBaseUrl,
          headerInfo,
          ...(config.security?.token ? { token: config.security.token } : {}),
          ...(config.security?.hostname ? { hostname: config.security.hostname } : {}),
        });
        // DH-0101: glyph wraps around the grepped "web UI ready at <url>" substring, never
        // rewrites it — the color/glyph sit before "web" and the reset lands before the URL
        // so `\S+` captures in e2e regexes (web.test.ts, connect-web.test.ts, spikes) stay
        // exactly the plain URL, no embedded ANSI.
        io.stdout(
          `dh: ${cliSuccessGlyph(process.stdout.isTTY === true)}web UI ready at ${handle.url} (connected to ${targetBaseUrl}).`,
        );
        return ExitCode.Success;
      }
      await deps.startTui(targetBaseUrl, config.security?.token);
      return ExitCode.Success;
    }

    // mode.kind is "local" or "server" — both start a real local DhServer. Round 8: maps
    // the run mode to the SessionClientKind stamped into every agent's log header this
    // process writes — `--server` is headless ("server"); local mode is "web" or "tui"
    // depending on which client attaches to the DhServer this process also starts.
    const clientKind: SessionClientKind =
      mode.kind === "server" ? "server" : mode.web ? "web" : "tui";
    // DH-0116: sessionId is generated once, here, and is authoritative — it's what
    // determines logDir/the server's own advertised sessionId below, so it must be the same
    // id AgentRuntime stamps into every log header it writes (via createAgentLoop), not an
    // independently-generated one. Previously AgentRuntime generated its own internal
    // sessionId, so log headers in --server mode didn't match the directory they were
    // written into, breaking --resume's header/directory consistency check (resume.ts).
    const sessionId = randomUUID();
    const logsRoot = join(process.cwd(), ".dh-logs");
    // DH-0037: see createStandaloneRuntime's identical call above for the rationale.
    pruneLogDirectories(logsRoot, config.logRetention, Date.now(), sessionId);
    const logDir = join(logsRoot, sessionId);
    const agentLoop = deps.createAgentLoop(
      config,
      systemPrompt,
      clientKind,
      sessionId,
      resumeResult
        ? {
            messages: resumeResult.messages,
            fromSessionId: resumeResult.resumedFromSessionId,
            model: resumeResult.model,
          }
        : undefined,
    );
    // DH-0067: operators repeatedly ask "is my TUI even connected?" with nothing on either
    // side to confirm — a dim one-liner per SSE connect/disconnect. `--quiet` suppresses it
    // along with the agent activity feed below (the startup block itself always prints).
    const server = deps.createServer({
      agentLoop,
      sessionId,
      logDir,
      port: mode.kind === "server" ? mode.port : 0,
      ...(config.security ? { security: config.security } : {}),
      ...(quiet
        ? {}
        : {
            onClientConnect: (addr: string) => io.stdout(`dh: client connected from ${addr}`),
            onClientDisconnect: (addr: string) => io.stdout(`dh: client disconnected from ${addr}`),
          }),
    });
    const boundPort = server.start();

    // DH-0067: `--server` mode used to print exactly one line at startup and then nothing,
    // ever, through real agent activity — the only way to know anything happened was to
    // already know where the JSONL logs lived. One concise stdout line per agent lifecycle
    // transition; never full output (that stays the clients'/JSONL logs' job). Scoped to
    // `--server` specifically — local/web/connect modes already have a real client (TUI or
    // web UI) providing their own moment-to-moment feedback.
    if (mode.kind === "server" && !quiet) {
      const feed = new ActivityFeed();
      const feedTty = process.stdout.isTTY === true;
      agentLoop.onEvent((event) => {
        const line = feed.onEvent(event, feedTty);
        if (line !== undefined) io.stdout(`dh: ${line}`);
      });
    }

    // DH-0038: an interactive session doesn't wait for the operator's first message to start
    // the root the way a fresh session does (no operator has attached yet when this runs) —
    // a resumed root should pick up where it crashed off immediately, not sit idle in
    // "waiting" for someone to notice and type something. Reuses the exact same lazy-start
    // sendMessage() path a real operator's first message would take (AgentRuntimeLoopAdapter's
    // doc comment) — from the loop's point of view this is indistinguishable from an operator
    // kicking things off with the resume notice as their first message.
    if (resumeResult) {
      agentLoop.sendMessage(ROOT_AGENT_ID, buildResumeNotice(resumeResult));
    }

    // DH-0011: this process owns real resources from here on (the DhServer's listening
    // socket, the AgentRuntime driving it) — exactly the "container receives SIGTERM on
    // scale-down" scenario HANDOFF.md's canonical deployment describes. `webHandle` is
    // populated by the `mode.web` branch below (if taken) — declared here, ahead of it, so
    // the shutdown closure captures whichever resources actually ended up live by the time a
    // signal fires, without duplicating this logic per branch.
    let webHandle: WebUiHandleLike | undefined;
    let shuttingDown = false;
    const uninstallSignals = deps.installSignalHandlers((signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      // DH-0067 fix: this used to go through io.stderr, which in a typical terminal/`docker
      // logs` viewer renders red — indistinguishable at a glance from an actual failure. A
      // clean SIGTERM/SIGINT shutdown is an ordinary lifecycle event, not a fault; printing
      // it via stdout (rather than inventing an ANSI-styling layer just to force a neutral
      // color on stderr) keeps it looking like what it is.
      io.stdout(`dh: received ${signal}; shutting down session ${sessionId}...`);
      try {
        agentLoop.stopAgent(ROOT_AGENT_ID);
      } catch {
        // best-effort — nothing running yet, or already stopped.
      }
      try {
        webHandle?.stop();
      } catch {
        // best-effort.
      }
      try {
        server.stop();
      } catch {
        // best-effort.
      }
      // DH-0002: best-effort — closes the shared McpManager (terminating stdio MCP child
      // processes); `.close` is optional on the handle type so tests injecting a bare fake
      // AgentLoopHandle (no MCP involved) don't need to implement it.
      void agentLoop.close?.()?.catch(() => {});
      uninstallSignals();
      io.exit(ExitCode.Success);
    });

    if (mode.kind === "server") {
      const panelTty = process.stdout.isTTY === true;
      // DH-0067/DH-0101: this exact line — including the "listening on port" substring — is
      // grepped by e2e's `waitForStdout` helpers (dh-process.ts and multiple spike scripts);
      // it stays byte-stable. The DH-0101 styling only wraps around it (a colored headline
      // glyph before "headless", nothing between/inside the grepped words), never rewrites
      // it — verified against every e2e grep site before landing this (search performed:
      // `grep -rn "listening on port" e2e/`).
      io.stdout(
        `dh: ${cliSuccessGlyph(panelTty)}headless server listening on port ${boundPort} (session ${sessionId}).`,
      );
      // DH-0067: `DhServer` only passes a `hostname` to `Bun.serve()` when the opt-in
      // `security.hostname` config field (DH-0022) is set — unset (the common case) is
      // still every interface, not just loopback — worth spelling out explicitly since
      // that's exactly the fact the posture note below depends on.
      const boundHost = config.security?.hostname ?? "0.0.0.0";
      io.stdout(
        `dh: ${cliBold(formatVersionString(BUILD_INFO), panelTty)} — bound to ${boundHost}:${boundPort} — logs: ${logDir}`,
      );
      io.stdout(`dh: connect with: dh --connect <host> --port ${boundPort}`);
      const posture = buildStartupPostureNote(config.security);
      // DH-0101: caution-marked (⚠, yellow/dim) rather than just another sentence in the
      // stack, per style-guide §5's "startup blocks read as a panel" convention — the glyph
      // is prepended after the existing "dh: " prefix, the note's own text is untouched.
      if (posture) io.stdout(`dh: ${cliCautionGlyph(panelTty)}${posture.replace(/^dh: /, "")}`);
      return ExitCode.Success;
    }

    const baseUrl = `http://localhost:${boundPort}`;
    if (mode.web) {
      webHandle = deps.serveWebUi({
        port: 0,
        targetBaseUrl: baseUrl,
        headerInfo,
        ...(config.security?.token ? { token: config.security.token } : {}),
        ...(config.security?.hostname ? { hostname: config.security.hostname } : {}),
      });
      // DH-0067/DH-0101: this exact "web UI ready at <url>." line is grepped by e2e
      // (web.test.ts, connect-web.test.ts, several spikes) — stays byte-stable; styling only
      // wraps the "dh: " prefix, never the substring itself.
      io.stdout(
        `dh: ${cliSuccessGlyph(process.stdout.isTTY === true)}web UI ready at ${webHandle.url}.`,
      );
      io.stdout(`dh: logs: ${logDir}`);
      return ExitCode.Success;
    }

    await deps.startTui(baseUrl, config.security?.token, { ownsServer: true });
    // DH-0059 backstop: guarantees no orphaned root agent regardless of *how* the TUI
    // resolved — a graceful Ctrl+C shutdown already stopped it (this is then a no-op re-abort
    // of an already-idempotent stopRoot()), but a force quit, the TUI's own fallback timer, or
    // a root that was never started all resolve `startTui` without ever having stopped it.
    try {
      agentLoop.stopAgent(ROOT_AGENT_ID);
    } catch {
      // best-effort — nothing running yet, or already stopped.
    }
    uninstallSignals();
    server.stop();
    return ExitCode.Success;
  } catch (err) {
    return fail(io, `failed to start ${mode.kind} mode: ${(err as Error).message}`);
  }
}

/**
 * `dh init` (DH-0035): scaffolds README.md's sample `dh.json` into the working directory (or
 * wherever `--config <path>` points). Refuses to overwrite an existing config file — fails
 * loudly rather than clobbering an operator's real config. Only `--config` is a meaningful
 * flag here; anything else is a usage error, same as any other unrecognized flag.
 */
async function runInit(argv: string[], deps: CliDeps): Promise<ExitCodeType> {
  const { io } = deps;
  let targetPath = DEFAULT_CONFIG_PATH;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      i += 1;
      const value = argv[i];
      if (value === undefined) {
        return fail(io, "--config requires a value");
      }
      targetPath = value;
      continue;
    }
    return fail(io, `unknown flag: ${arg}`);
  }

  let exists: boolean;
  try {
    exists = await deps.fileExists(targetPath);
  } catch (err) {
    return fail(io, `failed to check ${targetPath}: ${(err as Error).message}`);
  }
  if (exists) {
    return fail(
      io,
      `refusing to overwrite existing config file: ${targetPath} (remove it first, or pass --config <path> to scaffold somewhere else)`,
    );
  }

  try {
    await deps.writeFile(targetPath, SAMPLE_DH_JSON);
  } catch (err) {
    return fail(io, `failed to write ${targetPath}: ${(err as Error).message}`);
  }

  // DH-0101: success headline (✓, TTY-gated) + indented dim caveats + a set-off next-step
  // callout, per style-guide §5's "result headline, detail, next step" shape — replaces the
  // prior five equal `dh:` lines. Terse next-step wording per the ticket's own recommendation
  // (Open Questions: "keep terse").
  const initTty = process.stdout.isTTY === true;
  io.stdout(`dh: ${cliSuccessGlyph(initTty)}wrote a starter config to ${targetPath}.`);
  io.stdout(
    cliDim(
      `dh:   the models list is a menu covering every Claude tier on both anthropic and bedrock, plus a few Bedrock OpenAI and open-weight models — trim it down to the ones you'll actually use.`,
      initTty,
    ),
  );
  io.stdout(
    cliDim(
      `dh:   Bedrock model/inference-profile ids are verified for the us-east-1 region; re-verify if you're on a different region.`,
      initTty,
    ),
  );
  // DH-0119: real Amazon Bedrock Mantle is a distinct endpoint with two model-vendor-routed
  // API surfaces, both bearer-apiKey authenticated: "mantle-anthropic" (.../anthropic,
  // Anthropic Messages shape) and "mantle-openai" (.../openai/v1, Chat Completions shape —
  // note the "/openai" prefix: some Mantle models, gemma4 included, live on that prefixed
  // path specifically; the unprefixed path rejects them with a misleading "Berm is not
  // enabled for this account" error that has nothing to do with account access). Both
  // "gemma4" and "haiku-mantle" are live-verified working end to end, tool-use included.
  io.stdout(
    cliDim(
      `dh:   Amazon Bedrock Mantle needs BEDROCK_MANTLE_API_KEY. "haiku-mantle" and "gemma4" are both live-verified working end to end (tool-use included) — see tracking/DH-0119.`,
      initTty,
    ),
  );
  io.stdout(`dh: Next: run "dh doctor" to probe credentials, then "dh" to start.`);
  io.exit(ExitCode.Success);
  return ExitCode.Success;
}

/**
 * `dh doctor` / `--check` (DH-0035): for each configured model, makes one cheap no-op provider
 * call (a 1-token completion, no tools) and reports pass/fail — never enters the real agent
 * loop, so a broken credential/model-access problem surfaces before an operator commits to a
 * real (possibly costly, possibly unattended) run.
 *
 * DH-0106: on top of that connectivity check, a model that connects also gets a second, cheap
 * probe request that offers it one trivial no-op tool and instructs it to call it — this is a
 * distinct capability from "the API call succeeds" (DH-0106's root cause: a Bedrock model that
 * connects fine but responds with prose/fake fenced pseudo-tool-call text instead of a real
 * `tool_use` content block). `toolUse` is `undefined` when the connectivity check itself
 * failed (no point probing a model we can't even reach) or when the model reference doesn't
 * resolve to a provider at all; `false` means it connected but never emitted a real tool-use
 * block; `true` means it did.
 */
interface DoctorResult {
  modelName: string;
  ok: boolean;
  detail: string;
  toolUse?: boolean;
}

/** DH-0106: the trivial no-op tool offered to every model during the doctor tool-use capability
 * probe — deliberately as simple as a tool definition gets (no inputs) so a "can't call tools"
 * result reflects the model's own capability/willingness, not a schema it couldn't parse. */
const DOCTOR_TOOL_PROBE_DEFINITION: ProviderToolDefinition = Object.freeze<ProviderToolDefinition>({
  name: "noop",
  description: "A no-op probe tool. Call it with no arguments to confirm you can call tools.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
});

// DH-0101: aliases onto the shared CLI styling constants above (was its own copy) — dim
// still distinguishes "still checking" from a resolved verdict, per style-guide §1.1.
const DOCTOR_PASS_COLOR = Object.freeze(CLI_GREEN);
const DOCTOR_FAIL_COLOR = Object.freeze(CLI_RED);
const DOCTOR_PENDING_COLOR = Object.freeze(CLI_DIM);
const DOCTOR_RESET = Object.freeze(CLI_RESET);

// DH-0102: verdict word is always 4 chars ("PASS"/"FAIL"); the colorized (TTY) verdict field
// additionally carries a one-glyph + one-space prefix ("✓ "/"✗ "). The pending row's spinner
// frame is padded out to this same plain-text width so the name column starts at the same
// screen position whether a row is still pending or already resolved — cosmetic (the
// `\r\x1b[K` rewrite clears the whole line regardless), but it keeps a multi-model run's rows
// from visibly shifting left/right as each one resolves.
const DOCTOR_VERDICT_WORD_WIDTH = 4;
const DOCTOR_VERDICT_LABEL_WIDTH = Object.freeze(2 + DOCTOR_VERDICT_WORD_WIDTH);

/** Formats one resolved (pass/fail) row — shared by `formatDoctorReport` (the non-TTY /
 * final-summary path) and `runDoctor`'s TTY live-update path, so both agree on alignment and
 * colorization instead of drifting into two subtly different renderings of the same result.
 * DH-0102: on the colorized (TTY) path, prepends the canonical `✓`/`✗` verdict glyph (style
 * guide §5) before the PASS/FAIL word; the plain (non-TTY) path is untouched — just the bare
 * word, per the ticket's non-TTY contract. */
function formatDoctorRow(r: DoctorResult, nameWidth: number, color: boolean): string {
  // DH-0106: a model that connects (r.ok) but never emitted a real tool-use block in the
  // capability probe gets a distinct verdict word — "PASS (no tool-use)" — rather than a
  // plain PASS indistinguishable from a model that's actually reliable for agentic tool use.
  // Still green/✓ on the TTY path: it *did* pass connectivity, which is what that glyph means;
  // the qualifier text itself is what carries the "but not agentic-capable" distinction.
  const verdict = r.ok ? (r.toolUse === false ? "PASS (no tool-use)" : "PASS") : "FAIL";
  const coloredVerdict = color
    ? `${r.ok ? DOCTOR_PASS_COLOR : DOCTOR_FAIL_COLOR}${r.ok ? "✓" : "✗"} ${verdict}${DOCTOR_RESET}`
    : verdict;
  // A detail starting with ":" (the "no provider named..." case) reads as
  // "<name>: <message>", not "<name> : <message>" — every other detail ("(provider ...)")
  // gets a space before it as usual.
  const separator = r.detail.startsWith(":") ? "" : " ";
  return `${coloredVerdict} ${r.modelName.padEnd(nameWidth)}${separator}${r.detail}`;
}

/** DH-0099/DH-0102: the in-flight row shown the moment a model's check starts, before its
 * `provider.complete()` call resolves — same column alignment as the resolved row so the
 * later `\r` + clear-to-end-of-line rewrite lands in exactly the same place. Never used
 * outside a TTY (there's no "in flight" concept for a piped/CI run that only prints once at
 * the end). DH-0102: the marker is now the canonical braille spinner frame (shared with the
 * TUI via `../terminal.constant.ts`, not a bespoke `....`) and the wording is present-progressive
 * ("checking…") per the style guide's pending-state vocabulary (§1.1). `frame` is supplied by
 * the caller so `runDoctor` can advance it on a timer while a single check is outstanding. */
function formatDoctorPendingRow(
  modelName: string,
  nameWidth: number,
  color: boolean,
  frame: string,
): string {
  const label = frame.padEnd(DOCTOR_VERDICT_LABEL_WIDTH);
  const coloredVerdict = color ? `${DOCTOR_PENDING_COLOR}${label}${DOCTOR_RESET}` : label;
  return `${coloredVerdict} ${modelName.padEnd(nameWidth)} checking… (query sent)`;
}

/** DH-0067: unaligned `PASS <name> (provider "...")` lines with no summary read as a raw
 * dump, not a report an operator could paste into an incident/status update. Pads every
 * model name to the widest one in this run (so the `PASS`/`FAIL` word and the following
 * detail line up in a column) and colorizes the verdict word on a TTY — same gate as `dh
 * logs`' status colorization, same reasoning (a piped/redirected run stays plain text). */
export function formatDoctorReport(results: DoctorResult[], color: boolean): string[] {
  const nameWidth = Math.max(0, ...results.map((r) => r.modelName.length));
  const lines = results.map((r) => formatDoctorRow(r, nameWidth, color));
  const passCount = results.filter((r) => r.ok).length;
  const failCount = results.length - passCount;
  const summaryText = `${results.length} model${results.length === 1 ? "" : "s"}: ${passCount} pass, ${failCount} fail`;
  // DH-0102: colorize the summary line on the TTY path too (green all-pass / red any-fail)
  // so the overall result reads at a glance; the plain (non-TTY) path stays bare text.
  lines.push(
    color
      ? `${failCount === 0 ? DOCTOR_PASS_COLOR : DOCTOR_FAIL_COLOR}${summaryText}${DOCTOR_RESET}`
      : summaryText,
  );
  return lines;
}

/** DH-0099: on a real terminal, each model's row appears the instant its check starts (a
 * dim "...." pending row) and is then rewritten in place — `\r` back to column 0, `\x1b[K` to
 * clear whatever pending text was there, then the resolved PASS/FAIL row — once
 * `provider.complete()` settles, so an operator watching a multi-model config never stares at
 * a blank terminal wondering whether anything is happening. Piped/non-TTY output (CI, logs)
 * is untouched: no row is printed until every model has been checked, and the whole report is
 * printed once via the ordinary `io.stdout` path exactly as before this ticket. */
async function runDoctor(
  config: DhConfig,
  configPath: string,
  deps: CliDeps,
): Promise<ExitCodeType> {
  const { io } = deps;
  printAppHeader(config, configPath, io);
  const providersByName = new Map(config.provider.map((p) => [p.name, p]));
  const results: DoctorResult[] = [];
  const isTTY = process.stdout.isTTY === true;
  const nameWidth = Math.max(0, ...config.models.map((m) => m.name.length));

  for (const model of config.models) {
    // DH-0102: animate the pending row's spinner frame every SPINNER_FRAME_MS while this
    // model's single `provider.complete()` call is outstanding. TTY-gated (no timer, no
    // animation off a TTY) and always torn down in `finally` — on both the normal resolve
    // path and any unexpected throw — so a slow/hanging check can never leave a stray timer
    // running past this iteration, and the last tick can never race the final resolved-row
    // rewrite below (the interval is cleared before that write happens).
    let frameIndex = 0;
    let spinnerTimer: ReturnType<typeof setInterval> | undefined;
    if (isTTY) {
      process.stdout.write(
        formatDoctorPendingRow(model.name, nameWidth, true, SPINNER_FRAMES[0] as string),
      );
      spinnerTimer = setInterval(() => {
        frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
        process.stdout.write(
          `\r\x1b[K${formatDoctorPendingRow(model.name, nameWidth, true, SPINNER_FRAMES[frameIndex] as string)}`,
        );
      }, SPINNER_FRAME_MS);
    }

    let result: DoctorResult;
    try {
      const providerConfig = providersByName.get(model.provider);
      if (!providerConfig) {
        // Shouldn't happen post-validateConfig (models reference known providers), but a
        // provider-agnostic guard costs nothing and keeps this loop crash-free either way.
        result = {
          modelName: model.name,
          ok: false,
          detail: `: no provider named "${model.provider}" in config`,
        };
      } else {
        try {
          const provider = deps.createProvider(providerConfig);
          await provider.complete({
            model: model.model,
            system: "dh doctor: connectivity check.",
            messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
            tools: [],
            maxTokens: 1,
          });
          // DH-0106: connectivity alone doesn't confirm agentic tool use — probe separately
          // with one trivial no-op tool and an instruction to call it. A probe-call throw
          // (rare — connectivity just succeeded above) is treated the same as "no tool-use
          // block observed" rather than flipping the whole model to FAIL: the model
          // demonstrably answers requests, it just didn't produce a real tool call here.
          let toolUse = false;
          try {
            const toolProbe = await provider.complete({
              model: model.model,
              system:
                'dh doctor: tool-use capability probe. You must call the "noop" tool now; do not respond with text describing a call instead of making one.',
              messages: [
                { role: "user", content: [{ type: "text", text: "Call the noop tool now." }] },
              ],
              tools: [DOCTOR_TOOL_PROBE_DEFINITION],
              maxTokens: 64,
            });
            toolUse = toolProbe.content.some((block) => block.type === "tool_use");
          } catch {
            toolUse = false;
          }
          result = {
            modelName: model.name,
            ok: true,
            toolUse,
            detail: `(provider "${providerConfig.name}")`,
          };
        } catch (err) {
          result = {
            modelName: model.name,
            ok: false,
            detail: `(provider "${providerConfig.name}"): ${(err as Error).message}`,
          };
        }
      }
    } finally {
      if (spinnerTimer) {
        clearInterval(spinnerTimer);
      }
    }
    results.push(result);

    if (isTTY) {
      process.stdout.write(`\r\x1b[K${formatDoctorRow(result, nameWidth, true)}\n`);
    }
  }

  if (isTTY) {
    // Every row already streamed live above — only the trailing summary line is left.
    const summaryLine = formatDoctorReport(results, true).at(-1) as string;
    process.stdout.write(`${summaryLine}\n`);
  } else {
    for (const line of formatDoctorReport(results, false)) {
      io.stdout(line);
    }
  }

  const code = results.every((r) => r.ok) ? ExitCode.Success : ExitCode.HarnessError;
  io.exit(code);
  return code;
}

/**
 * `--dry-run` (DH-0035): validates everything up to but not including the first real model
 * call — config (already loaded by the time this runs), the instructions file if
 * `--instructions` was given, and provider client construction for every configured provider
 * — then exits 0 without spending any tokens.
 */
async function runDryRun(
  options: CliOptions,
  config: DhConfig,
  deps: CliDeps,
): Promise<ExitCodeType> {
  const { io } = deps;

  if (options.instructions !== null) {
    try {
      await deps.readInstructions(options.instructions);
    } catch (err) {
      return fail(io, (err as Error).message);
    }
  }

  for (const providerConfig of config.provider) {
    try {
      deps.createProvider(providerConfig);
    } catch (err) {
      return fail(
        io,
        `provider "${providerConfig.name}" failed to construct: ${(err as Error).message}`,
      );
    }
  }

  io.stdout(
    `dh: ${cliSuccessGlyph(process.stdout.isTTY === true)}dry run OK — config, instructions file, and provider client construction all validated. No model was called.`,
  );
  io.exit(ExitCode.Success);
  return ExitCode.Success;
}

/** Runs the CLI end to end. Returns the exit code it either passed to `deps.io.exit` (real
 * process) or would have (tests inject a no-op `exit` and read the return value instead). */
export async function main(
  argv: string[],
  overrides: Partial<CliDeps> = {},
): Promise<ExitCodeType> {
  const deps: CliDeps = { ...defaultDeps(), ...overrides };
  const { io } = deps;

  // DH-0037: `dh logs <sessionDir>` is a standalone subcommand, not one of the interactive
  // run modes composed by flags — it never touches config/provider/AgentRuntime, so it's
  // handled first, before flag parsing and `dh.json` loading, same as --help/--version.
  if (argv[0] === "logs") {
    const sessionDir = argv[1];
    // DH-0067: no argument used to be a usage error, forcing the operator to `ls .dh-logs`
    // and copy a UUID by hand. Lists every session directory under the default
    // "./.dh-logs" root instead.
    if (sessionDir === undefined) {
      try {
        io.stdout(formatSessionList(join(process.cwd(), ".dh-logs")));
      } catch (err) {
        return fail(io, (err as Error).message);
      }
      io.exit(ExitCode.Success);
      return ExitCode.Success;
    }
    try {
      // DH-0067: colorize status words the same way the TUI does, gated on a real TTY (a
      // piped/redirected `dh logs` — e.g. into a file for a bug report — stays plain text,
      // same convention as `dh doctor`'s PASS/FAIL colorization below).
      io.stdout(formatSessionLogTree(sessionDir, { color: process.stdout.isTTY === true }));
    } catch (err) {
      return fail(io, (err as Error).message);
    }
    io.exit(ExitCode.Success);
    return ExitCode.Success;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout(renderHelpText(helpColumns(), process.stdout.isTTY === true));
    io.exit(ExitCode.Success);
    return ExitCode.Success;
  }

  if (argv.includes("--version")) {
    // DH-0101: light emphasis (bold app name) on a TTY; formatVersionString itself stays a
    // pure plain-text formatter (other call sites/tests depend on that), so the bolding is
    // applied here, at the print site, only to the leading "dh" app-name token.
    const versionString = formatVersionString(BUILD_INFO);
    const tty = process.stdout.isTTY === true;
    io.stdout(tty ? versionString.replace(/^dh/, cliBold("dh", true)) : versionString);
    io.exit(ExitCode.Success);
    return ExitCode.Success;
  }

  // `dh init` (DH-0035): a subcommand, not a flag — handled before parseArgs (which has no
  // concept of positional subcommands) and, like --help/--version, never depends on a working
  // dh.json existing yet.
  if (argv[0] === "init") {
    return runInit(argv.slice(1), deps);
  }

  // `dh doctor` (DH-0035): a documented alias for `--check`, for operators who reach for a
  // subcommand rather than a flag. Strips "doctor" off the front and folds it into the same
  // --check flag path below so it gets the exact same handling (including --config support).
  const isDoctorSubcommand = argv[0] === "doctor";
  const argvForParsing = isDoctorSubcommand ? argv.slice(1) : argv;

  let options: CliOptions;
  try {
    options = parseArgs(argvForParsing);
  } catch (err) {
    return fail(io, (err as Error).message);
  }
  if (isDoctorSubcommand) {
    options.check = true;
  }

  const mode = composeMode(options);

  if (options.env !== null) {
    try {
      const content = await deps.readEnvFile(options.env);
      const vars = parseEnvFile(content);
      deps.applyEnv(vars);
    } catch (err) {
      return fail(io, (err as Error).message);
    }
  }

  let config: DhConfig;
  try {
    config = await deps.loadConfig(options.config);
  } catch (err) {
    return fail(io, (err as Error).message);
  }

  let systemPrompt: string;
  try {
    systemPrompt = await deps.loadSystemPrompt(config);
  } catch (err) {
    return fail(io, (err as Error).message);
  }

  // DH-0035: both --check/`dh doctor` and --dry-run stop here — config and systemPrompt are
  // already validated by this point, and neither mode ever enters the interactive/standalone
  // agent loop below.
  if (options.check) {
    return runDoctor(config, options.config, deps);
  }
  if (options.dryRun) {
    return runDryRun(options, config, deps);
  }

  // DH-0038: `--resume <sessionId>` — resolved once, up front, before branching into the
  // standalone vs. interactive paths below (both need the same replayed history/model).
  let resumeResult: ResumeResult | undefined;
  if (options.resume !== null) {
    // No wire command exists for delivering reconstructed history to a remote server (D3);
    // the logs it would be reconstructed from live on that server's filesystem, not this
    // process's, so there's nothing local to even read.
    if (mode.kind === "connect") {
      return fail(
        io,
        "--resume is not supported with --connect (logs live on the server's filesystem).",
      );
    }
    try {
      resumeResult = deps.loadResumeSession(join(process.cwd(), ".dh-logs"), options.resume);
    } catch (err) {
      return fail(io, `cannot resume session "${options.resume}": ${(err as Error).message}`);
    }
    // D3: an unresolvable model alias is a clean startup error, never a silent fallback to
    // config.options.defaultModel — continuing an hours-long run on the wrong model would be
    // far worse than refusing to start.
    if (!config.models.some((m) => m.name === resumeResult?.model)) {
      return fail(
        io,
        `cannot resume session "${options.resume}": model alias "${resumeResult.model}" from the original session no longer exists in this config; known models: ${config.models.map((m) => m.name).join(", ")}`,
      );
    }
  }

  if (options.instructions === null) {
    return runInteractiveMode(
      mode,
      config,
      options.config,
      systemPrompt,
      deps,
      resumeResult,
      options.quiet,
    );
  }

  // Standalone dark-factory path: deliberately bypasses Server/TUI/Web entirely, even in
  // this round with all three landed (docs/handoffs/core.md Round 2 status log, point 3 —
  // "don't regress the exit-code path you already built and verified via live subprocess
  // runs"). `--connect` has no wire-protocol command to start a brand-new root agent
  // remotely (ClientCommand only covers send_message/stop_agent/request_agent_tree/
  // download_logs against an *already-running* session), so it stays unsupported here.
  if (mode.kind === "connect") {
    return fail(
      io,
      "--instructions is not supported with --connect yet (remote instruction delivery is a " +
        "Server-domain feature not landed in this round).",
    );
  }

  let instructionText: string;
  try {
    instructionText = await deps.readInstructions(options.instructions);
  } catch (err) {
    return fail(io, (err as Error).message);
  }
  // DH-0038: `--instructions` combined with `--resume` (D3) — the file's content becomes the
  // post-resume message, appended after the standard resume notice (rather than replacing it),
  // so the "restart happened, history was reconstructed, here's what didn't survive" context
  // is never silently dropped just because the operator also supplied fresh instructions.
  if (resumeResult) {
    instructionText = `${buildResumeNotice(resumeResult)}\n\n${instructionText}`;
  }

  // DH-0050 (`--job --json`): every ServerSentEvent the root runtime emits is written to
  // stdout as one NDJSON line, as-is — no separate incremental schema, the existing
  // versioned event union (src/contracts/events.type.ts) is reused verbatim. `undefined` in
  // every other mode, so createRuntime()/createStandaloneRuntime() behave exactly as before
  // this ticket (no `onEvent` at all) when `--json` wasn't given.
  const onJsonEvent = options.json
    ? (event: ServerSentEvent) => io.stdout(JSON.stringify(event))
    : undefined;

  const runtime = deps.createRuntime(
    config,
    systemPrompt,
    "none",
    resumeResult
      ? {
          messages: resumeResult.messages,
          fromSessionId: resumeResult.resumedFromSessionId,
          model: resumeResult.model,
        }
      : undefined,
    onJsonEvent,
  );

  // DH-0011: the standalone `--instructions`/`--job` path is exactly the unattended
  // dark-factory scenario a container's SIGTERM/SIGINT can interrupt mid-run — best-effort
  // cooperative stop via the same AbortSignal-driven mechanism TaskStop/stopRoot() already
  // use (loop.ts's AgentLoopParams.signal), rather than the process just dying with no
  // chance to log anything.
  let interrupted = false;
  const uninstallSignals = deps.installSignalHandlers((signal) => {
    interrupted = true;
    // DH-0067 fix: same reasoning as the interactive-mode SIGTERM/SIGINT notice — this is a
    // normal lifecycle event, not a failure, so it goes to stdout rather than the
    // error-red-in-most-terminals stderr stream.
    io.stdout(`dh: received ${signal}; stopping the root agent...`);
    runtime.stopRoot();
  });

  let result: {
    success: boolean;
    finalOutput: string;
    turns: number;
    outcome?: ReportedOutcome;
    reportedBy?: OutcomeReportedBy;
  };
  try {
    result = await runtime.runRoot(instructionText);
  } catch (err) {
    uninstallSignals();
    await runtime.close?.()?.catch(() => {});
    return fail(io, `root agent crashed: ${(err as Error).message}`);
  }
  uninstallSignals();

  // DH-0050: in --json mode, human-readable finalOutput text never hits stdout on its own —
  // the terminal job_result NDJSON line (below) is the one place it's carried, so a
  // downstream parser reading stdout line-by-line as NDJSON never has to skip a stray
  // non-JSON line mixed in. Judgment call: `JobResultLine.exitCode` is typed `0 | 1` per the
  // architect design (mirroring the model self-report outcome, not the full harness-error
  // exit-code space) — an operator-interrupted (SIGTERM/SIGINT) or crashed run has no
  // self-report outcome to describe at all, so neither emits a job_result line; a downstream
  // parser reading the NDJSON stream sees it end with no terminal line, same signal a piped
  // process getting killed already gives any NDJSON consumer.
  // DH-0037 (`summary.json`): built unconditionally (not just under `--json`) so it can also
  // back `summary.json`'s fields — the `--json`-gated NDJSON line and the on-disk summary
  // file are two independent ways to read the exact same terminal facts about the run, not
  // two different sources of truth for them.
  const buildJobResultLine = (): JobResultLine => ({
    version: 1,
    type: "job_result",
    timestamp: new Date().toISOString(),
    success: result.success,
    exitCode: result.success ? ExitCode.Success : ExitCode.TaskFailure,
    reportedBy: result.reportedBy ?? (result.success ? "clean-end" : "text-marker"),
    turns: result.turns,
    finalOutput: result.finalOutput,
    ...(result.outcome !== undefined ? { outcome: result.outcome } : {}),
  });
  const emitJobResult = (line: JobResultLine) => {
    if (!onJsonEvent) return;
    io.stdout(JSON.stringify(line));
  };

  if (interrupted) {
    if (!options.json) io.stdout(result.finalOutput);
    await runtime.close?.()?.catch(() => {});
    io.exit(ExitCode.HarnessError);
    return ExitCode.HarnessError;
  }

  if (!options.json) io.stdout(result.finalOutput);
  // DH-0002: best-effort — closes the shared McpManager (terminating stdio MCP child
  // processes) now that this standalone run has finished; the `--job` branch below starts a
  // brand-new AgentRuntime/session, so this one's MCP connections have no further use.
  await runtime.close?.()?.catch(() => {});

  if (!options.job) {
    // Without --job the process stays alive after completion for inspection (HANDOFF.md
    // §2) — now via the same real interactive surface the no-instructions path uses. Note
    // this is a fresh AgentRuntime/session, not a continuation of the one that just ran the
    // instruction (unifying those is out of scope this round — see the status log).
    //
    // DH-0038: this transition is otherwise invisible to the operator — the job's final
    // output prints, then a silent, contextless session starts with no indication the
    // conversation didn't just continue. Say so explicitly. Full crash-recovery/session-
    // resume design is separately handled by the architect; out of scope here.
    //
    // DH-0067 fix: moved from io.stderr to io.stdout — this is a normal lifecycle
    // transition, not an error, and used to render in the same alarming red as a real
    // failure in a typical terminal/`docker logs` viewer (same reasoning as the SIGTERM
    // notice above).
    io.stdout(
      "dh: job complete; starting a new interactive session (prior context is not preserved)",
    );
    return runInteractiveMode(
      mode,
      config,
      options.config,
      systemPrompt,
      deps,
      undefined,
      options.quiet,
    );
  }

  const jobResultLine = buildJobResultLine();
  // DH-0037: `summary.json` — written into the finished session's own log directory,
  // alongside its per-agent JSONL, once the run has genuinely completed (not on interrupt or
  // crash, both of which return above before reaching here). Best-effort: `runtime.sessionId`
  // is only absent for cli.test.ts's hand-written fakes that don't model a real session/log
  // directory at all (see the `CliDeps.createRuntime` doc comment) — a real run always has
  // one. A write failure (disk full, permissions) is reported but doesn't change the run's
  // own success/exit code, matching `runtime.close()`'s same best-effort treatment above.
  if (runtime.sessionId !== undefined) {
    const logDir = join(process.cwd(), ".dh-logs", runtime.sessionId);
    try {
      const summary = buildSessionSummary(runtime.sessionId, logDir, jobResultLine);
      writeSessionSummary(logDir, summary);
    } catch (err) {
      io.stderr(`dh: failed to write summary.json: ${(err as Error).message}`);
    }
  }
  emitJobResult(jobResultLine);
  const code = result.success ? ExitCode.Success : ExitCode.TaskFailure;
  io.exit(code);
  return code;
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
