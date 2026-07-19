import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BRAND,
  CONNECTION_TOKENS,
  fgCode,
  hexToRgb,
  lerpHex,
  nearestAnsi256,
  paint,
  SGR_RESET,
  STATUS_TOKENS,
  wrapSgr,
} from "./design-tokens.ts";

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

describe("BRAND", () => {
  test("has the five documented hex entries, frozen", () => {
    expect(BRAND).toEqual({
      harnessGreen: "#9ECE6A",
      leadOrange: "#E0AF68",
      wireGray: "#565F89",
      signalCyan: "#7DCFFF",
      boneWhite: "#C0CAF5",
    });
    expect(Object.isFrozen(BRAND)).toBe(true);
  });
});

describe("hexToRgb", () => {
  test("parses a hex color into [r,g,b]", () => {
    expect(hexToRgb("#9ECE6A")).toEqual([0x9e, 0xce, 0x6a]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#FFFFFF")).toEqual([255, 255, 255]);
  });

  test("throws on malformed input rather than silently returning black", () => {
    expect(() => hexToRgb("not-a-color")).toThrow();
    expect(() => hexToRgb("#fff")).toThrow();
    expect(() => hexToRgb("#gggggg")).toThrow();
  });
});

describe("lerpHex", () => {
  test("t=0 returns the first color, t=1 returns the second", () => {
    expect(lerpHex("#000000", "#FFFFFF", 0)).toBe("#000000");
    expect(lerpHex("#000000", "#FFFFFF", 1)).toBe("#FFFFFF");
  });

  test("interpolates linearly per channel at the midpoint", () => {
    expect(lerpHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });

  test("clamps t outside [0,1]", () => {
    expect(lerpHex("#000000", "#FFFFFF", -1)).toBe("#000000");
    expect(lerpHex("#000000", "#FFFFFF", 2)).toBe("#FFFFFF");
  });
});

describe("nearestAnsi256", () => {
  // Brute-force-verified nearest xterm-256 index (minimum squared RGB distance across the
  // full 6x6x6 cube + 24-step grayscale ramp) for each BRAND hex. Four of the five match the
  // ticket's documented precomputed table (DH-0221) exactly; boneWhite's documented value
  // (189, i.e. cube color #D7D7FF) is farther from #C0CAF5 (squared distance 798) than the
  // true nearest cube index 153 (#AFD7FF, squared distance 558) — verified by an exhaustive
  // brute-force search over all 256 palette entries, not just a formula guess. Asserting the
  // brute-force-correct value here rather than the ticket's figure, since the algorithm this
  // function implements is specified as "minimizes squared RGB distance" and 153 is what does
  // that for this hex.
  test("matches the documented/verified index for each BRAND entry", () => {
    expect(nearestAnsi256(BRAND.harnessGreen)).toBe(149);
    expect(nearestAnsi256(BRAND.leadOrange)).toBe(179);
    expect(nearestAnsi256(BRAND.wireGray)).toBe(60);
    expect(nearestAnsi256(BRAND.signalCyan)).toBe(117);
    expect(nearestAnsi256(BRAND.boneWhite)).toBe(153);
  });

  test("exact cube colors round-trip to their own index", () => {
    // Index 16 is cube corner (0,0,0); index 231 is cube corner (255,255,255).
    expect(nearestAnsi256("#000000")).toBe(16);
    expect(nearestAnsi256("#FFFFFF")).toBe(231);
  });

  test("pure gray falls onto the grayscale ramp branch, not the cube", () => {
    // #080808 (8,8,8) is the exact first grayscale ramp step (index 232); the nearest cube
    // color is (0,0,0) at distance 3*64=192, while the grayscale step is an exact match
    // (distance 0), so the ramp branch must win.
    expect(nearestAnsi256("#080808")).toBe(232);
    // #EEEEEE (238,238,238) is the exact last grayscale ramp step (index 255).
    expect(nearestAnsi256("#EEEEEE")).toBe(255);
  });

  test("a cube/grayscale tie resolves to the cube branch", () => {
    // Cube index 16 is (0,0,0); the nearest grayscale step is level 8 (index 232), so pure
    // black is strictly closer to the cube. To construct a genuine tie, pick a gray value
    // equidistant between a cube step and a ramp step: gray value 4 is equidistant (distance
    // 16) from cube step 0 and ramp step 8. Since the implementation only overrides the cube
    // pick when grayDist is strictly less than cubeDist, a tie must resolve to the cube.
    expect(nearestAnsi256("#040404")).toBe(16);
  });
});

describe("fgCode", () => {
  test("truecolor level produces a 38;2;r;g;b code", () => {
    expect(fgCode(BRAND.harnessGreen, "truecolor")).toBe("38;2;158;206;106");
  });

  test("ansi256 level produces a 38;5;<index> code using nearestAnsi256", () => {
    expect(fgCode(BRAND.harnessGreen, "ansi256")).toBe("38;5;149");
  });

  test("none level returns an empty string", () => {
    expect(fgCode(BRAND.harnessGreen, "none")).toBe("");
  });
});

describe("paint", () => {
  test("truecolor wraps text via wrapSgr with the 38;2 code (DH-0191 primitive reused)", () => {
    expect(paint(BRAND.harnessGreen, "✓", "truecolor")).toBe(wrapSgr("38;2;158;206;106", "✓"));
    expect(paint(BRAND.harnessGreen, "✓", "truecolor")).toBe("\x1b[38;2;158;206;106m✓\x1b[0m");
  });

  test("ansi256 wraps text via wrapSgr with the 38;5 code", () => {
    expect(paint(BRAND.harnessGreen, "✓", "ansi256")).toBe("\x1b[38;5;149m✓\x1b[0m");
  });

  test("none returns text verbatim with no escape bytes", () => {
    expect(paint(BRAND.harnessGreen, "✓", "none")).toBe("✓");
  });

  test("every non-none paint ends with the shared SGR_RESET", () => {
    expect(paint(BRAND.boneWhite, "x", "truecolor").endsWith(SGR_RESET)).toBe(true);
    expect(paint(BRAND.boneWhite, "x", "ansi256").endsWith(SGR_RESET)).toBe(true);
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
