import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CONNECTION_TOKENS, STATUS_TOKENS } from "./design-tokens.ts";

const ALL_STATUSES = ["running", "waiting", "done", "failed", "stopped"] as const;
const ALL_CONNECTION_STATES = ["connecting", "live", "reconnecting", "disconnected"] as const;

// style-guide.md §1 / §2.3 hue map — the table this module must stay mechanically in sync
// with (DH-0137). If either drifts, this test and the doc must both be updated together.
const EXPECTED_STATUS: Record<(typeof ALL_STATUSES)[number], { webHex: string; sgr: string }> = {
  running: { webHex: "#4f8cff", sgr: "34" },
  waiting: { webHex: "#f5a524", sgr: "33" },
  done: { webHex: "#35c469", sgr: "32" },
  failed: { webHex: "#f2545b", sgr: "31" },
  stopped: { webHex: "#9a7bd1", sgr: "35" },
};

// style-guide.md §1.2 — connection-state table.
const EXPECTED_CONNECTION: Record<
  (typeof ALL_CONNECTION_STATES)[number],
  { webLabel: string; tuiLabel: string; sgr: string; pending: boolean }
> = {
  connecting: { webLabel: "Connecting…", tuiLabel: "connecting…", sgr: "33", pending: true },
  live: { webLabel: "Live", tuiLabel: "live", sgr: "32", pending: false },
  reconnecting: { webLabel: "Reconnecting…", tuiLabel: "reconnecting…", sgr: "33", pending: true },
  disconnected: { webLabel: "Disconnected", tuiLabel: "disconnected", sgr: "31", pending: false },
};

describe("STATUS_TOKENS", () => {
  test("has a complete entry for all five AgentStatus values", () => {
    expect(Object.keys(STATUS_TOKENS).sort()).toEqual([...ALL_STATUSES].sort());
  });

  for (const status of ALL_STATUSES) {
    test(`${status} matches style-guide.md §1/§2.3 (word, glyph, webVar, webHex, sgr)`, () => {
      const token = STATUS_TOKENS[status];
      expect(token.word).toBe(status);
      expect(token.glyph).toBe("●");
      expect(token.webVar).toBe(`--status-${status}`);
      expect(token.webHex).toBe(EXPECTED_STATUS[status].webHex);
      expect(token.sgr).toBe(EXPECTED_STATUS[status].sgr);
    });
  }
});

describe("CONNECTION_TOKENS", () => {
  test("has a complete entry for all four connection states", () => {
    expect(Object.keys(CONNECTION_TOKENS).sort()).toEqual([...ALL_CONNECTION_STATES].sort());
  });

  for (const state of ALL_CONNECTION_STATES) {
    test(`${state} matches style-guide.md §1.2 (webLabel, tuiLabel, sgr, pending)`, () => {
      const token = CONNECTION_TOKENS[state];
      expect(token.webLabel).toBe(EXPECTED_CONNECTION[state].webLabel);
      expect(token.tuiLabel).toBe(EXPECTED_CONNECTION[state].tuiLabel);
      expect(token.sgr).toBe(EXPECTED_CONNECTION[state].sgr);
      expect(token.pending).toBe(EXPECTED_CONNECTION[state].pending);
    });
  }

  test("pending is true only for connecting/reconnecting", () => {
    expect(CONNECTION_TOKENS.connecting.pending).toBe(true);
    expect(CONNECTION_TOKENS.reconnecting.pending).toBe(true);
    expect(CONNECTION_TOKENS.live.pending).toBe(false);
    expect(CONNECTION_TOKENS.disconnected.pending).toBe(false);
  });
});

describe("no competing status-record declarations (regression guard)", () => {
  // Walks src/ looking for any file (other than this module and its test) declaring a
  // `Record<AgentStatus, ...>`-shaped literal — the exact pattern that let src/tui/render.ts's
  // (removed, DH-0136) STATUS_COLOR and src/web/client/format.ts's STATUS_STYLES independently
  // drift from this module's canonical table. src/web/client/format.ts is still pre-migration
  // (DH-0135 owns removing it) — the ticket's intent is "no *new* competing record", not "the
  // one pre-migration file doesn't exist yet" — so it's explicitly allowlisted here as
  // known-existing debt slated for removal, not a false pass.
  const PRE_MIGRATION_ALLOWLIST = new Set([
    join("src", "web", "client", "format.ts"),
    // dh logs' offline dump — out of scope for DH-0135/DH-0136's React/Ink migration
    // (neither ticket touches src/cli.ts); left as known debt for a future ticket.
    join("src", "cli.ts"),
  ]);

  function walk(dir: string, out: string[]): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full, out);
      } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        out.push(full);
      }
    }
    return out;
  }

  test("no file outside the shared module declares Record<AgentStatus, ...>", () => {
    const files = walk("src", []);
    const offenders: string[] = [];
    for (const file of files) {
      const normalized = file.replace(/^\.\//, "");
      if (
        normalized === join("src", "design-tokens.ts") ||
        normalized === join("src", "design-tokens.test.ts")
      ) {
        continue;
      }
      if (PRE_MIGRATION_ALLOWLIST.has(normalized)) continue;
      const content = readFileSync(file, "utf8");
      if (/Record<AgentStatus,/.test(content)) {
        offenders.push(normalized);
      }
    }
    expect(offenders).toEqual([]);
  });
});
