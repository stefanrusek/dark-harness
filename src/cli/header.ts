// DH-0220: dual-mode startup header redesign — replaces the old flat figlet-banner +
// plain-status-line startup output (see git history of `printAppHeader`,
// src/cli/activity-feed.ts) with two mode-selected headers:
//
//   Header A2 — full 12-line ANSI-Shadow wordmark + a 5-line status tree off a health dot.
//               Interactive TTY runs (local mode, `--connect` without `--web`).
//   Header B  — framed instrument panel with a compact `dh` glyph + tagline + status rows +
//               a "✓ ready" transition line. Web-serve mode and `--server` ("headless").
//
// Both consume, never re-derive, DH-0221's color primitives (`src/design-tokens.ts`'s
// `BRAND`/`paint`/`lerpHex`, `src/cli/color-context.ts`'s `detectColorLevel`) and DH-0220's
// own wordmark/glyph strings (`src/prompt/banner.constant.ts`, Prompt domain). This module
// owns only the layout/gating/color-application logic around that content — Core's slice of
// the ticket per its Functional Requirements.
import {
  BRAND,
  type ColorLevel,
  fgCode,
  lerpHex,
  paint,
  STATUS_TOKENS,
  wrapSgr,
} from "../design-tokens.ts";
import {
  HEADER_A2_WORDMARK,
  HEADER_A2_WORDMARK_PLAIN,
  HEADER_B_GLYPH,
  HEADER_B_TAGLINE,
} from "../prompt/banner.constant.ts";

/** Git SHA truncated to 7 chars for on-screen headers — the full SHA remains available via
 * `dh --version` (formatVersionString, header-info.ts), which this function does not touch. */
export function shortGitSha(gitSha: string | null | undefined): string {
  if (!gitSha) return "unstamped";
  return gitSha.slice(0, 7);
}

/** `.dh-logs/<sessionId>` (or any absolute path ending the same way) shortened to just the
 * run-id directory component, e.g. `/abs/.dh-logs/ac817fd0-...` -> `ac817fd0…`. Truncates the
 * id itself to 8 chars + an ellipsis, matching the ticket's mockups (`ac817fd0…`). */
export function shortLogDir(logDir: string): string {
  const base = logDir.split(/[\\/]/).filter(Boolean).pop() ?? logDir;
  return base.length > 8 ? `${base.slice(0, 8)}…` : base;
}

/** Header A2's size gate (Functional Requirements): needs >=80 cols AND >=30 rows, else the
 * plain-text fallback (`DARK HARNESS` + `|-`/backtick tree) applies regardless of color
 * support. Header B has no row minimum — only the shared 80-col width budget, checked
 * separately by callers via `columns >= 80`. */
export function sizeGateOk(columns: number, rows: number): boolean {
  return columns >= 80 && rows >= 30;
}

export interface HeaderStatusFacts {
  version: string;
  gitSha: string | null | undefined;
  /** e.g. "dh.json — 14 models" or "not found (dh.json)" — same content as
   * `formatConfigStatusLine` minus the "config: " prefix (the header supplies its own label
   * per line, per the tree/frame layout). */
  configLine: string;
  bindHost: string;
  hasToken: boolean;
  webUiUrl?: string;
  /** Undefined for `--connect` (no local session directory is created — logs live on the
   * remote server's filesystem); when set, shortened via `shortLogDir`. */
  logDir?: string;
}

function healthDot(level: ColorLevel, healthy: boolean): string {
  const hex = healthy ? STATUS_TOKENS.done.webHex : BRAND.leadOrange;
  return paint(hex, "●", level);
}

function warnGlyph(level: ColorLevel): string {
  return paint(BRAND.leadOrange, "⚠", level);
}

function label(text: string, level: ColorLevel): string {
  return paint(BRAND.wireGray, text, level);
}

function value(text: string, level: ColorLevel): string {
  return paint(BRAND.boneWhite, text, level);
}

function url(text: string, level: ColorLevel): string {
  // Underline + signalCyan for interactive/URL values (ticket: "URL in signal cyan
  // (underlined)"). Underline (`4`) composes with the truecolor/ansi256 fgCode the same way
  // any other SGR parameter does — appended to the color code string.
  if (level === "none") return text;
  return wrapSgr(`4;${fgCode(BRAND.signalCyan, level)}`, text);
}

function authText(facts: HeaderStatusFacts, level: ColorLevel): string {
  return facts.hasToken ? value("token required", level) : `${warnGlyph(level)} no token`;
}

/** Header A2's gradient wordmark: each source line painted left-to-right, char-by-char,
 * interpolating from `harnessGreen` to `signalCyan` across the line's width. `level ===
 * "none"` (or the size gate failing) short-circuits to the plain fallback before this is
 * ever called — see `renderHeaderA2`. */
function gradientWordmark(source: string, level: ColorLevel): string[] {
  return source.split("\n").map((line) => {
    const width = Math.max(1, line.length - 1);
    let out = "";
    for (let i = 0; i < line.length; i++) {
      const t = width === 0 ? 0 : i / width;
      out += paint(lerpHex(BRAND.harnessGreen, BRAND.signalCyan, t), line[i] as string, level);
    }
    return out;
  });
}

/** Header A2 — full wordmark + 5-line status tree off a health dot. Falls back to plain text
 * (`DARK HARNESS` + `|-`/backtick tree) when `level === "none"` or the terminal is smaller
 * than the size gate (`sizeGateOk`). */
export function renderHeaderA2(
  facts: HeaderStatusFacts,
  level: ColorLevel,
  terminal: { columns: number; rows: number },
): string[] {
  const plain = level === "none" || !sizeGateOk(terminal.columns, terminal.rows);
  const healthy = true; // No startup health-check surface exists yet to fail this dot red.
  if (plain) {
    return [
      HEADER_A2_WORDMARK_PLAIN,
      "",
      `* dh ${facts.version} - ${shortGitSha(facts.gitSha)}`,
      `|- config   ${facts.configLine}`,
      `|- bind     ${facts.bindHost}${facts.hasToken ? "" : " - no token"}`,
      ...(facts.webUiUrl ? [`|- web ui   ${facts.webUiUrl}`] : []),
      ...(facts.logDir ? [`\`- logs     ${shortLogDir(facts.logDir)}`] : []),
    ];
  }
  const lines = [...gradientWordmark(HEADER_A2_WORDMARK, level), ""];
  lines.push(
    `  ${healthDot(level, healthy)} ${value(`dh ${facts.version}`, level)} ${label("·", level)} ${label(shortGitSha(facts.gitSha), level)}`,
  );
  lines.push(`  ${label("├─ config", level)}   ${value(facts.configLine, level)}`);
  lines.push(
    `  ${label("├─ bind", level)}     ${value(facts.bindHost, level)} ${label("·", level)} ${authText(facts, level)}`,
  );
  if (facts.webUiUrl) {
    lines.push(`  ${label("├─ web ui", level)}   ${url(facts.webUiUrl, level)}`);
  }
  if (facts.logDir) {
    lines.push(`  ${label("└─ logs", level)}     ${value(shortLogDir(facts.logDir), level)}`);
  }
  return lines;
}

/** Header B — framed instrument panel + `✓ ready` transition line. Falls back to plain text
 * when `level === "none"` (no row-count gate beyond the shared 80-col budget). */
export function renderHeaderB(facts: HeaderStatusFacts, level: ColorLevel): string[] {
  const plain = level === "none";
  const shaLine = `dh ${facts.version} - ${shortGitSha(facts.gitSha)}`;
  if (plain) {
    const lines = [
      `-- ${shaLine} ${"-".repeat(Math.max(0, 47 - shaLine.length))}`,
      `${HEADER_B_GLYPH[0]}    ${HEADER_B_TAGLINE[0]}`,
      `${HEADER_B_GLYPH[1]}    ${HEADER_B_TAGLINE[1]}`,
      "-".repeat(51),
      `config  ${facts.configLine}`,
      `bind    ${facts.bindHost}    auth  ${facts.hasToken ? "required" : "none"}`,
    ];
    if (facts.webUiUrl) lines.push(`web ui  ${facts.webUiUrl}`);
    if (facts.logDir) lines.push(`logs    ${shortLogDir(facts.logDir)}`);
    lines.push("* ready - waiting for clients");
    return lines;
  }

  const frame = (text: string) => paint(BRAND.wireGray, text, level);
  const width = 49; // interior width, matches the ticket's mockup budget (<=80 cols total).
  const nameplate = ` dh ${facts.version} ${label("─", level)} ${shortGitSha(facts.gitSha)} `;
  const topFill = "─".repeat(Math.max(0, width + 2 - visibleLen(nameplate) - 2));
  const lines: string[] = [];
  // DH-0247: each row's right border must land at the same column as the frame's own
  // corners — pad the content to the interior width (`width - 2`, matching the "  " lead-in
  // after the left `│`) using visibleLen() so SGR-colored text doesn't over-count. Previously
  // several rows appended the closing `│` immediately after the content with no padding (or
  // hand-tuned, easily-stale padding), so the right edge drifted to wherever that row's own
  // text happened to end.
  const row = (content: string): string => {
    const pad = Math.max(0, width - 2 - visibleLen(content));
    return `  ${frame("│")}  ${content}${" ".repeat(pad)}${frame("│")}`;
  };
  lines.push(`  ${frame("╭─")}${nameplate}${frame(`${topFill}╮`)}`);
  lines.push(
    row(
      `${paint(lerpHex(BRAND.harnessGreen, BRAND.signalCyan, 0.5), HEADER_B_GLYPH[0] as string, level)}    ${value(HEADER_B_TAGLINE[0] as string, level)}`,
    ),
  );
  lines.push(
    row(
      `${paint(lerpHex(BRAND.harnessGreen, BRAND.signalCyan, 0.5), HEADER_B_GLYPH[1] as string, level)}    ${label(HEADER_B_TAGLINE[1] as string, level)}`,
    ),
  );
  lines.push(`  ${frame(`├${"─".repeat(width)}┤`)}`);
  lines.push(row(`${label("config", level)}  ${value(facts.configLine, level)}`));
  lines.push(
    row(
      `${label("bind", level)}    ${value(facts.bindHost, level)}    ${label("auth", level)}  ${authText(facts, level)}`,
    ),
  );
  if (facts.webUiUrl) {
    lines.push(row(`${label("web ui", level)}  ${url(facts.webUiUrl, level)}`));
  }
  if (facts.logDir) {
    lines.push(row(`${label("logs", level)}    ${value(shortLogDir(facts.logDir), level)}`));
  }
  lines.push(`  ${frame(`╰${"─".repeat(width)}╯`)}`);
  lines.push(`  ${paint(BRAND.harnessGreen, "✓", level)} ready — waiting for clients`);
  return lines;
}

const ESC = Object.freeze(String.fromCharCode(27));

/** Visible width of `text`, ignoring any `ESC [ ... m` SGR escape sequences it contains —
 * used to size the box-drawing frame around content that already has color applied. Split on
 * the escape character rather than a control-character regex literal (project lint bans
 * those) since this only needs to find/skip one specific byte. */
function visibleLen(text: string): number {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === ESC && text[i + 1] === "[") {
      const end = text.indexOf("m", i);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out.length;
}

/**
 * DH-0220 owner decision #3: Header B's `✓ ready` treatment extends to subsequent `dh:`
 * log-line prefixes printed during the run (client connect/disconnect, activity-feed lines,
 * the headless-server/web-ready startup lines) — restyles the `dh:` prefix itself in
 * harnessGreen to match the header's established visual language. The literal `dh: ` prefix
 * text is never altered (only its surrounding color) — e2e helpers that grep for it by exact
 * text keep matching; see run.ts's call sites and this ticket's e2e audit notes.
 *
 * `level === "none"` returns the prefix unchanged (no escape bytes), matching every other
 * `paint` call in this module.
 */
export function styleDhPrefix(level: ColorLevel): string {
  return `${paint(BRAND.harnessGreen, "dh:", level)} `;
}
