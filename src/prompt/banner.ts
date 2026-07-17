// DH-0121: `dh`'s ASCII-art logo, for TUI/CLI banner use (DH-0122/DH-0124 wire this into the
// startup screen once the UI overhaul lands). Kept plain ASCII, no box-drawing or SGR bytes
// baked in -- callers TTY-gate color/glyphs themselves (see src/cli.ts's CLI_* helpers), and
// log aggregators piping raw output must stay byte-plain per that same precedent.

/** Full block wordmark, for splash/startup screens with room to spare (5 lines tall). */
export const DH_ASCII_LOGO = `
      _  _
   __| || |__
  / _\` || '_ \\
 | (_| || | | |
  \\__,_||_| |_|
`.replace(/^\n|\n$/g, "");

/** Single-line mark, for narrow terminals or inline use (status bars, log headers). */
export const DH_ASCII_LOGO_COMPACT = "[ dh ]";
