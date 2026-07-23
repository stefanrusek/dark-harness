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
