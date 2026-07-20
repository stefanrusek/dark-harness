// DH-0121: `dh`'s ASCII-art logo, for TUI/CLI banner use (DH-0122/DH-0124 wire this into the
// startup screen once the UI overhaul lands). Kept plain ASCII, no box-drawing or SGR bytes
// baked in -- callers TTY-gate color/glyphs themselves (see src/cli.ts's CLI_* helpers), and
// log aggregators piping raw output must stay byte-plain per that same precedent.

/** Full block wordmark, for splash/startup screens with room to spare (5 lines tall). */
export const DH_ASCII_LOGO = `      _  _
   __| || |__
  / _\` || '_ \\
 | (_| || | | |
  \\__,_||_| |_|`;

/** Single-line mark, for narrow terminals or inline use (status bars, log headers). */
export const DH_ASCII_LOGO_COMPACT = "[ dh ]";

// DH-0220: dual-mode startup header redesign — Header A2 (interactive) and Header B
// (web/headless). Wordmark/glyph content lives here (Prompt domain, banner-string
// convention); the color/gradient/frame rendering around these strings lives in
// src/cli/header.ts (Core), which never re-derives ASCII art of its own.

/**
 * Header A2's full 12-line ANSI-Shadow wordmark ("DARK" stacked over "HARNESS"), drop-shadow
 * rows included per the owner's 2026-07-19 decision (full weight over the trimmed 10-line
 * variant). Rendered with a left-to-right green->cyan gradient by the caller — this constant
 * carries no color of its own, matching every other banner constant in this file.
 */
export const HEADER_A2_WORDMARK = `  ██████╗  █████╗ ██████╗ ██╗  ██╗
  ██╔══██╗██╔══██╗██╔══██╗██║ ██╔╝
  ██║  ██║███████║██████╔╝█████╔╝
  ██║  ██║██╔══██║██╔══██╗██╔═██╗
  ██████╔╝██║  ██║██║  ██║██║  ██╗
  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝
       ██╗  ██╗ █████╗ ██████╗ ███╗   ██╗███████╗███████╗███████╗
       ██║  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██╔════╝██╔════╝
       ███████║███████║██████╔╝██╔██╗ ██║█████╗  ███████╗███████╗
       ██╔══██║██╔══██║██╔══██╗██║╚██╗██║██╔══╝  ╚════██║╚════██║
       ██║  ██║██║  ██║██║  ██║██║ ╚████║███████╗███████║███████║
       ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝╚══════╝`;

/**
 * Plain-text fallback for Header A2 when the size gate fails or color is unavailable
 * (`level === "none"`, <30 rows, or <80 cols) — a single "DARK HARNESS" wordmark line, no
 * box-drawing/gradient, per the ticket's Functional Requirements.
 */
export const HEADER_A2_WORDMARK_PLAIN = "DARK HARNESS";

/**
 * Header B's compact `dh` glyph (2 lines, block-and-triangle style), left column of the
 * framed instrument panel next to the "dark harness / local model harness" tagline.
 */
export const HEADER_B_GLYPH = ["██▄ █░█", "█▄█ █▀█"];

/** Header B's two-line tagline, shown to the right of `HEADER_B_GLYPH`. */
export const HEADER_B_TAGLINE = ["dark harness", "local model harness"];
