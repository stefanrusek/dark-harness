// DH-0174 (Core, extracted from cli.ts): `--server`-mode operator output — the app header and
// the per-agent-lifecycle activity feed.
import { BUILD_INFO } from "../config/build-info.ts";
import type { DhConfig, SecurityConfig, ServerSentEvent } from "../contracts/index.ts";
import { buildHeaderInfo, formatHeaderLines, formatVersionString } from "../header-info.ts";
// DH-0101: reuse Web's short-id formatter for the activity feed rather than forking the
// logic (ticket's explicit ask) — pure, DOM-free (only a type-only import of its own), and
// Web's client bundle is already part of this binary's dependency graph via serveWebUiClient,
// so this adds no new runtime surface.
import { shortAgentId } from "../web/client/format.ts";
import type { CliIo } from "./deps.ts";
import { cliBold, cliDim, cliStatusDot } from "./styling.ts";

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
 * as a panel" convention already used by the rest of this file's startup output.
 *
 * DH-0123: `config` is `null` for `dh init`'s pre-write header (no config exists yet at that
 * point — the whole point of `init`) — `buildHeaderInfo` already documents and handles this
 * "not loaded yet" shape, rendering the same "config: not found (<path>)" status line `doctor`
 * shows for a genuinely missing file. */
export function printAppHeader(config: DhConfig | null, configPath: string, io: CliIo): void {
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
