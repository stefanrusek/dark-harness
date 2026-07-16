// Shared plumbing for the DH-0060 TUI behavioral spike scripts (see
// tracking/DH-0060-tui-overnight-behavioral-test-agent-tmux-text-screenshot-verification-suite.md).
//
// These spikes are NOT `bun test` files on purpose: they are standalone scripts a haiku-tier
// verification sub-agent runs directly (`bun e2e/spikes/tui/spike-<name>.ts`) and whose
// stdout it interprets — a stable, machine-readable PASS/FAIL report with the captured tmux
// pane attached as evidence. `bun test e2e` never picks them up (no `.test.` in the name),
// so they add no CI-gate surface; typecheck and lint still cover them.
//
// Everything real comes from the existing e2e support modules — same compiled binary
// (scripts/build.ts via ensureBuilt), same mock Anthropic provider, same tmux PTY harness
// the committed e2e tests use. A spike is just those pieces plus explicit reporting.

import { ensureBuilt } from "../../support/build.ts";
import type { MockAnthropicProvider, MockTurn } from "../../support/mock-provider.ts";
import { startMockAnthropicProvider } from "../../support/mock-provider.ts";
import type { TmuxSession } from "../../support/tmux-pty.ts";
import { startTmuxSession } from "../../support/tmux-pty.ts";
import { baseConfig, createWorkspace } from "../../support/workspace.ts";

export interface SpikeCheck {
  label: string;
  pass: boolean;
  /** Shown on failure — what was expected vs. what the pane actually held. */
  detail?: string;
}

/** `screen` must contain `needle`. */
export function expectContains(screen: string, needle: string, label: string): SpikeCheck {
  const pass = screen.includes(needle);
  return {
    label,
    pass,
    ...(pass ? {} : { detail: `expected pane to contain ${JSON.stringify(needle)}` }),
  };
}

/** `screen` must NOT contain `needle` (raw Markdown syntax, a hostile escape sequence, …). */
export function expectAbsent(screen: string, needle: string, label: string): SpikeCheck {
  const pass = !screen.includes(needle);
  return {
    label,
    pass,
    ...(pass ? {} : { detail: `expected pane to NOT contain ${JSON.stringify(needle)}` }),
  };
}

export function expectTrue(pass: boolean, label: string, detail?: string): SpikeCheck {
  return { label, pass, ...(detail === undefined ? {} : { detail }) };
}

export interface SpikeTui {
  session: TmuxSession;
  provider: MockAnthropicProvider;
  /** Kills the tmux session, stops the mock provider, removes the temp workspace. */
  stop(): void;
}

export interface BootOptions {
  /** Wraps the compiled binary path into the command tmux runs — used e.g. to capture the
   * process's exit code in the pane:
   * `(bin) => ["sh", "-c", `"${bin}"; echo EXIT:$?; sleep 60`]`. */
  wrapCommand?: (binaryPath: string) => string[];
  cols?: number;
  rows?: number;
}

/** Builds the real binary, points a temp-workspace `dh.json` at a mock provider scripted
 * with `turns`, launches `dh` (local mode: embedded server + TUI) under a real tmux PTY, and
 * waits for the TUI shell to render. Mirrors e2e/tui.test.ts's boot sequence exactly. */
export async function bootLocalTui(
  turns: MockTurn[],
  options: BootOptions = {},
): Promise<SpikeTui> {
  const provider = startMockAnthropicProvider(turns);
  const ws = createWorkspace("dh-spike-");
  ws.writeConfig(baseConfig(provider.baseURL));
  const binaryPath = await ensureBuilt();

  const command = options.wrapCommand ? options.wrapCommand(binaryPath) : [binaryPath];
  const session = startTmuxSession(command, {
    cwd: ws.dir,
    cols: options.cols ?? 100,
    rows: options.rows ?? 30,
  });
  const stop = () => {
    session.kill();
    provider.stop();
    ws.cleanup();
  };

  try {
    await session.waitFor((screen) => screen.includes("Dark Harness"));
    await session.waitFor((screen) => screen.includes("Root Agent"));
  } catch (error) {
    stop();
    throw error;
  }
  return { session, provider, stop };
}

/** Prints the machine-readable report the verification sub-agent parses, then exits the
 * process: 0 if every check passed, 1 otherwise. The final captured pane is always attached
 * as evidence, pass or fail.
 *
 * IMPORTANT: this calls `process.exit`, which skips `finally` blocks — call it only AFTER
 * `stop()` has run (capture evidence and build checks inside the try, clean up in finally,
 * report last). Getting this wrong leaks a live tmux session + dh process per run, which an
 * overnight suite would accumulate by the dozens. */
export function reportAndExit(
  spikeName: string,
  checks: SpikeCheck[],
  evidencePane: string,
): never {
  console.log(`=== SPIKE: ${spikeName} ===`);
  for (const check of checks) {
    const status = check.pass ? "[PASS]" : "[FAIL]";
    const detail = check.detail ? ` — ${check.detail}` : "";
    console.log(`${status} ${check.label}${detail}`);
  }
  console.log("--- captured pane evidence (plain text, tmux capture-pane -p) ---");
  console.log(evidencePane.trimEnd());
  console.log("--- end evidence ---");
  const failed = checks.filter((check) => !check.pass).length;
  if (failed === 0) {
    console.log(`RESULT: PASS (${checks.length}/${checks.length} checks)`);
    process.exit(0);
  }
  console.log(`RESULT: FAIL (${checks.length - failed}/${checks.length} checks passed)`);
  process.exit(1);
}
